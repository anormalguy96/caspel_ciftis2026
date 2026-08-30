"""Voice-message transcription: validation, cleanup and log safety."""
import logging
import os
from unittest.mock import MagicMock, patch

import pytest

from app.rag.errors import ProviderUnavailableError
from app.rag.transcription import (
    ALLOWED_MIME_TYPES,
    MAX_UPLOAD_BYTES,
    TranscriptionRejected,
    TranscriptionService,
    normalise_mime,
    validate_upload,
)


# ==========================================================================
# Upload validation
# ==========================================================================

@pytest.mark.parametrize("mime", sorted(ALLOWED_MIME_TYPES))
def test_supported_container_formats_are_accepted(mime):
    assert validate_upload(mime, 1024)


def test_codec_parameter_is_tolerated():
    assert validate_upload("audio/webm;codecs=opus", 1024) == "audio/webm"
    assert validate_upload("AUDIO/WEBM; codecs=opus", 1024) == "audio/webm"


@pytest.mark.parametrize(
    "mime",
    [
        "application/octet-stream",
        "video/mp4",
        "text/plain",
        "image/png",
        "application/x-executable",
        "",
        None,
    ],
)
def test_everything_outside_the_allowlist_is_refused(mime):
    with pytest.raises(TranscriptionRejected):
        validate_upload(mime, 1024)


def test_empty_upload_is_refused():
    with pytest.raises(TranscriptionRejected, match="empty_upload"):
        validate_upload("audio/webm", 0)


def test_oversized_upload_is_refused():
    with pytest.raises(TranscriptionRejected, match="upload_too_large"):
        validate_upload("audio/webm", MAX_UPLOAD_BYTES + 1)


def test_upload_at_exactly_the_limit_is_accepted():
    assert validate_upload("audio/webm", MAX_UPLOAD_BYTES)


def test_normalise_mime_handles_absent_headers():
    assert normalise_mime(None) == ""
    assert normalise_mime("") == ""


# ==========================================================================
# Provider unavailable
# ==========================================================================

def test_transcribe_fails_honestly_without_a_provider():
    srv = TranscriptionService()
    srv.api_key = None
    srv._client = None

    with pytest.raises(ProviderUnavailableError):
        srv.transcribe(b"audio-bytes", "audio/webm")


def test_transcription_model_is_separate_from_the_chat_model():
    from app.core.config import settings

    srv = TranscriptionService()
    assert srv.model_name == settings.GEMINI_TRANSCRIPTION_MODEL
    assert srv.model_name != settings.GEMINI_CHAT_MODEL


# ==========================================================================
# Cleanup: the audio must not outlive the call, on either side
# ==========================================================================

def _live_service(generate_result=None, generate_exc=None):
    srv = TranscriptionService()
    srv.api_key = "test-key"
    client = MagicMock()
    uploaded = MagicMock()
    uploaded.name = "files/abc123"
    client.files.upload.return_value = uploaded
    if generate_exc is not None:
        client.models.generate_content.side_effect = generate_exc
    else:
        client.models.generate_content.return_value = generate_result
    srv._client = client
    return srv, client


def test_temporary_file_is_removed_after_success():
    result = MagicMock()
    result.text = "Which modules does Caspel ERP include?"
    srv, client = _live_service(generate_result=result)

    seen = {}
    real_upload = client.files.upload

    def capture(file):
        seen["path"] = file
        return real_upload.return_value

    client.files.upload = capture

    out = srv.transcribe(b"audio", "audio/webm")

    assert out.text == "Which modules does Caspel ERP include?"
    assert "path" in seen
    assert not os.path.exists(seen["path"]), "temporary audio survived a successful call"


def test_temporary_file_is_removed_after_provider_failure():
    srv, client = _live_service(generate_exc=RuntimeError("boom"))

    seen = {}
    real_upload = client.files.upload

    def capture(file):
        seen["path"] = file
        return real_upload.return_value

    client.files.upload = capture

    with pytest.raises(ProviderUnavailableError):
        srv.transcribe(b"audio", "audio/webm")

    assert not os.path.exists(seen["path"]), "temporary audio survived a failed call"


def test_provider_side_upload_is_deleted_after_success():
    result = MagicMock()
    result.text = "a transcript"
    srv, client = _live_service(generate_result=result)

    srv.transcribe(b"audio", "audio/webm")

    client.files.delete.assert_called_once()


def test_provider_side_upload_is_deleted_after_failure():
    srv, client = _live_service(generate_exc=RuntimeError("boom"))

    with pytest.raises(ProviderUnavailableError):
        srv.transcribe(b"audio", "audio/webm")

    client.files.delete.assert_called_once()


def test_a_failed_provider_cleanup_does_not_break_a_good_transcript():
    result = MagicMock()
    result.text = "a transcript"
    srv, client = _live_service(generate_result=result)
    client.files.delete.side_effect = RuntimeError("cleanup failed")

    assert srv.transcribe(b"audio", "audio/webm").text == "a transcript"


def test_empty_transcript_is_reported_rather_than_returned():
    result = MagicMock()
    result.text = "   "
    srv, _ = _live_service(generate_result=result)

    with pytest.raises(ProviderUnavailableError):
        srv.transcribe(b"audio", "audio/webm")


# ==========================================================================
# Log safety
# ==========================================================================

def test_no_transcript_audio_or_path_reaches_the_log(caplog):
    result = MagicMock()
    result.text = "zzTRANSCRIPTzz about Caspel ERP"
    srv, _ = _live_service(generate_result=result)

    with caplog.at_level(logging.DEBUG):
        srv.transcribe(b"zzAUDIOBYTESzz", "audio/webm")

    assert "zzTRANSCRIPTzz" not in caplog.text
    assert "zzAUDIOBYTESzz" not in caplog.text
    assert "caspel-voice-" not in caplog.text
    assert "files/abc123" not in caplog.text


def test_a_provider_exception_message_never_reaches_the_log(caplog):
    # A provider error can carry the prompt or the file URI in its message.
    srv, _ = _live_service(generate_exc=RuntimeError("zzPROVIDERDETAILzz files/abc"))

    with caplog.at_level(logging.DEBUG), pytest.raises(ProviderUnavailableError):
        srv.transcribe(b"audio", "audio/webm")

    assert "zzPROVIDERDETAILzz" not in caplog.text


def test_the_api_key_never_reaches_the_log(caplog):
    result = MagicMock()
    result.text = "ok"
    srv, _ = _live_service(generate_result=result)
    srv.api_key = "zzSECRETKEYzz"

    with caplog.at_level(logging.DEBUG):
        srv.transcribe(b"audio", "audio/webm")

    assert "zzSECRETKEYzz" not in caplog.text


def test_the_vocabulary_carries_the_product_names_the_model_would_mangle():
    from app.rag.transcription import VOCABULARY

    for term in ("CASPEL", "Caspel ERP", "IRISSEA", "LRIT", "CIFTIS"):
        assert term in VOCABULARY
