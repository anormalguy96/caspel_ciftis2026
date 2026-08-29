"""
Timeout classification and the retry budget.

The defect these pin down: `_is_transient_error` used to match on `str(error)`.
httpx timeout exceptions stringify to `''`, and the one that does carry text
says "timed out" — which does not contain the substring "timeout". So every
timeout was classified permanent and never retried, making the single most
retry-worthy failure the only one guaranteed to fail fast. It surfaced as a
real 503 on a live verification run.

The other half of these tests is the budget: retrying a timeout is only
acceptable while a visitor cannot be made to wait through several 20-second
stalls to reach the same failure.
"""
import asyncio
import logging
from unittest.mock import MagicMock

import httpx
import pytest

import app.rag.generation as gen
from app.rag.errors import GenerationError
from app.rag.generation import (
    GENERATION_DEADLINE_SECONDS,
    GENERATION_MAX_TIMEOUT_RETRIES,
    _is_permanent_error,
    _is_timeout_error,
    _is_transient_error,
)
from app.rag.retrieval import RetrievedChunk


def _chunk() -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id=1, document_id=1, document_name="CASPEL ERP Presentation",
        product="erp", page_number=4, chunk_index=0,
        content="Caspel ERP covers finance and procurement.", score=0.9,
    )


def _service(monkeypatch, side_effect, *, clock=None):
    """A live-provider service whose Gemini call does `side_effect`."""
    monkeypatch.setattr(gen.time, "sleep", lambda _: None)
    if clock is not None:
        monkeypatch.setattr(gen.time, "monotonic", lambda: clock["t"])

    service = gen.GenerationService()
    service.api_key = "test-api-key"
    client = MagicMock()
    client.models.generate_content.side_effect = side_effect
    service._client = client
    return service, client


class SdkWrapper(Exception):
    """Stands in for an SDK error raised from a transport failure."""


# ==========================================================================
# 1-3. Timeout types are transient, whatever they stringify to
# ==========================================================================

def test_empty_string_read_timeout_is_transient():
    """The exact shape that made every timeout look permanent."""
    error = httpx.ReadTimeout("")

    assert str(error) == ""
    assert _is_timeout_error(error) is True
    assert _is_transient_error(error) is True


@pytest.mark.parametrize(
    "error",
    [
        httpx.ConnectTimeout(""),
        httpx.WriteTimeout(""),
        httpx.PoolTimeout(""),
        httpx.ReadTimeout(""),
    ],
    ids=["connect", "write", "pool", "read"],
)
def test_every_httpx_timeout_subclass_is_transient(error):
    assert _is_timeout_error(error) is True
    assert _is_transient_error(error) is True


@pytest.mark.parametrize("text", ["timed out", "Timed Out", "TIMEOUT", "read timeout"])
def test_timeout_prose_is_transient_case_insensitively(text):
    """Secondary compatibility path, for providers that only say it in words."""
    assert _is_transient_error(Exception(text)) is True


def test_builtin_and_asyncio_timeout_are_transient():
    assert _is_transient_error(TimeoutError()) is True
    assert _is_transient_error(asyncio.TimeoutError()) is True


# ==========================================================================
# 4-5. Exception chain
# ==========================================================================

def test_sdk_wrapper_caused_by_httpx_timeout_is_transient():
    """SDKs wrap transport errors; the timeout is a __cause__, not the surface."""
    try:
        try:
            raise httpx.ReadTimeout("")
        except httpx.ReadTimeout as inner:
            raise SdkWrapper("upstream call failed") from inner
    except SdkWrapper as wrapped:
        assert _is_timeout_error(wrapped) is True
        assert _is_transient_error(wrapped) is True


def test_timeout_nested_two_levels_deep_is_found():
    try:
        try:
            try:
                raise httpx.ConnectTimeout("")
            except httpx.ConnectTimeout as a:
                raise SdkWrapper("transport") from a
        except SdkWrapper as b:
            raise SdkWrapper("api") from b
    except SdkWrapper as outer:
        assert _is_transient_error(outer) is True


def test_exception_chain_survives_a_cycle():
    """A __context__ cycle must not hang the error handler."""
    first = SdkWrapper("first")
    second = SdkWrapper("second")
    first.__cause__ = second
    second.__cause__ = first

    visited = list(gen._exception_chain(first))

    assert len(visited) == 2
    assert _is_transient_error(first) is False


def test_exception_chain_is_depth_bounded():
    error = SdkWrapper("head")
    current = error
    for _ in range(50):
        nxt = SdkWrapper("link")
        current.__cause__ = nxt
        current = nxt

    assert len(list(gen._exception_chain(error))) <= gen._MAX_CHAIN_NODES


# ==========================================================================
# 6. Permanent errors stay permanent
# ==========================================================================

@pytest.mark.parametrize(
    "message",
    [
        "400 INVALID_ARGUMENT: request malformed",
        "401 UNAUTHENTICATED: missing credentials",
        "403 PERMISSION_DENIED: caller lacks permission",
        "404 NOT_FOUND: models/does-not-exist is not found",
        "API key not valid. Please pass a valid API key.",
    ],
)
def test_permanent_provider_errors_are_not_retryable(message):
    error = Exception(message)

    assert _is_permanent_error(error) is True
    assert _is_transient_error(error) is False


def test_status_code_beats_prose():
    """A 400 that happens to mention a deadline is still a bad request."""
    error = MagicMock(spec=[])
    error.__class__ = type("ClientError", (Exception,), {})
    permanent = error.__class__("400 INVALID_ARGUMENT: deadline field invalid")
    permanent.code = 400

    assert _is_transient_error(permanent) is False


def test_429_and_503_remain_transient():
    for status in (408, 429, 500, 502, 503, 504):
        error = Exception(f"{status} upstream")
        error.code = status
        assert _is_transient_error(error) is True, status


# ==========================================================================
# 7-9. Retry budget
# ==========================================================================

def test_a_timeout_is_retried_at_most_once(monkeypatch):
    service, client = _service(monkeypatch, side_effect=httpx.ReadTimeout(""))

    with pytest.raises(GenerationError):
        service.generate_response("What is ERP?", [_chunk()])

    assert client.models.generate_content.call_count == 1 + GENERATION_MAX_TIMEOUT_RETRIES == 2


def test_retry_after_a_timeout_returns_the_grounded_answer(monkeypatch):
    ok = MagicMock()
    ok.text = "Caspel ERP covers finance and procurement."
    service, client = _service(monkeypatch, side_effect=[httpx.ReadTimeout(""), ok])

    result = service.generate_response("What is ERP?", [_chunk()])

    assert result.answer == "Caspel ERP covers finance and procurement."
    assert client.models.generate_content.call_count == 2


def test_repeated_timeouts_finish_inside_the_total_deadline(monkeypatch):
    """
    Two 20-second stalls must not become a 40-second wait.

    Mocked clock: each attempt burns the full per-request timeout. The second
    attempt is capped by what remains of the 30s deadline, and no third is
    started.
    """
    clock = {"t": 0.0}

    def stall(*_args, **_kwargs):
        clock["t"] += gen.GENERATION_REQUEST_TIMEOUT_SECONDS
        raise httpx.ReadTimeout("")

    service, client = _service(monkeypatch, side_effect=stall, clock=clock)

    with pytest.raises(GenerationError):
        service.generate_response("What is ERP?", [_chunk()])

    assert client.models.generate_content.call_count <= 2
    assert clock["t"] <= GENERATION_DEADLINE_SECONDS + gen.GENERATION_REQUEST_TIMEOUT_SECONDS


def test_a_retry_is_capped_by_the_remaining_deadline(monkeypatch):
    """The second attempt must not be granted another full-length timeout."""
    clock = {"t": 0.0}
    seen_timeouts = []

    def record_then_stall(*_args, **kwargs):
        seen_timeouts.append(kwargs["config"].http_options.timeout)
        clock["t"] += gen.GENERATION_REQUEST_TIMEOUT_SECONDS
        raise httpx.ReadTimeout("")

    service, _ = _service(monkeypatch, side_effect=record_then_stall, clock=clock)

    with pytest.raises(GenerationError):
        service.generate_response("What is ERP?", [_chunk()])

    assert len(seen_timeouts) == 2
    assert seen_timeouts[0] == gen.GENERATION_REQUEST_TIMEOUT_SECONDS * 1000
    # Only ~10s of the 30s deadline is left by then.
    assert seen_timeouts[1] < seen_timeouts[0]
    assert sum(seen_timeouts) <= GENERATION_DEADLINE_SECONDS * 1000


def test_no_attempt_is_started_without_time_to_finish(monkeypatch):
    clock = {"t": 0.0}

    def burn_almost_everything(*_args, **_kwargs):
        clock["t"] += GENERATION_DEADLINE_SECONDS - 1
        raise httpx.ReadTimeout("")

    service, client = _service(monkeypatch, side_effect=burn_almost_everything, clock=clock)

    with pytest.raises(GenerationError):
        service.generate_response("What is ERP?", [_chunk()])

    assert client.models.generate_content.call_count == 1


def test_explicit_transient_provider_errors_keep_their_attempts(monkeypatch):
    """The 429/503 path is unchanged by the timeout work."""
    service, client = _service(monkeypatch, side_effect=Exception("503 UNAVAILABLE: high demand"))

    with pytest.raises(GenerationError):
        service.generate_response("What is ERP?", [_chunk()])

    assert client.models.generate_content.call_count == gen.GENERATION_MAX_ATTEMPTS


# ==========================================================================
# 10. Cancellation
# ==========================================================================

def test_cancellation_is_not_swallowed_or_retried(monkeypatch):
    service, client = _service(monkeypatch, side_effect=asyncio.CancelledError())

    with pytest.raises(asyncio.CancelledError):
        service.generate_response("What is ERP?", [_chunk()])

    assert client.models.generate_content.call_count == 1


def test_cancellation_is_never_classified_transient():
    assert _is_transient_error(asyncio.CancelledError()) is False
    assert _is_timeout_error(asyncio.CancelledError()) is False


def test_a_timeout_wrapping_cancellation_is_not_retried():
    try:
        try:
            raise asyncio.CancelledError()
        except asyncio.CancelledError as inner:
            raise SdkWrapper("aborted") from inner
    except SdkWrapper as wrapped:
        assert _is_transient_error(wrapped) is False


# ==========================================================================
# 11. Secret-safe logging
# ==========================================================================

API_KEY_MARKER = "AIzaSyTESTKEY_zzq_do_not_log_9137"
PROMPT_MARKER = "zzq-visitor-question-marker-4471"
CHUNK_MARKER = "zzq-slide-content-marker-8823"


def test_logs_never_contain_the_key_prompt_or_document_text(monkeypatch, caplog):
    """
    A provider that echoes the request back must not turn a log line into a
    disclosure of the visitor's question, CASPEL's slide text, or the API key.
    """
    hostile = Exception(
        f"400 error calling https://host/v1beta/models/x?key={API_KEY_MARKER} "
        f"with body containing {PROMPT_MARKER} and {CHUNK_MARKER}"
    )
    service, _ = _service(monkeypatch, side_effect=hostile)
    service.api_key = API_KEY_MARKER

    chunk = RetrievedChunk(
        chunk_id=1, document_id=1, document_name="CASPEL ERP Presentation",
        product="erp", page_number=4, chunk_index=0,
        content=CHUNK_MARKER, score=0.9,
    )

    with caplog.at_level(logging.DEBUG):
        with pytest.raises(GenerationError) as raised:
            service.generate_response(PROMPT_MARKER, [chunk])

    for marker in (API_KEY_MARKER, PROMPT_MARKER, CHUNK_MARKER):
        assert marker not in caplog.text
        assert marker not in str(raised.value)

    assert "key=" not in caplog.text
    assert "https://" not in caplog.text


def test_safe_summary_reports_diagnosis_without_content():
    error = httpx.ReadTimeout("")
    summary = gen._safe_error_summary(error, attempt=2, remaining=7.25)

    assert summary["error_type"] == "ReadTimeout"
    assert summary["transient"] is True
    assert summary["timeout"] is True
    assert summary["attempt"] == 2
    assert summary["remaining_s"] == 7.2


def test_quota_hint_extracts_only_validated_identifiers():
    """Structured details only, each value validated before it can be logged."""
    error = Exception("quota")
    error.details = {
        "error": {
            "message": f"leaky message containing {PROMPT_MARKER}",
            "details": [
                {
                    "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                    "violations": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}],
                },
                {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "57s"},
            ],
        }
    }

    quota_id, retry_delay = gen._quota_hint(error)

    assert quota_id == "GenerateRequestsPerDayPerProjectPerModel-FreeTier"
    assert retry_delay == "57s"


def test_quota_hint_rejects_an_unsafe_value():
    error = Exception("quota")
    error.details = [
        {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            "violations": [{"quotaId": f"has spaces and {PROMPT_MARKER}"}],
        }
    ]

    quota_id, _ = gen._quota_hint(error)

    assert quota_id is None
