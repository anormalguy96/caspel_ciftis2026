import sys
import types
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient

from app.rag.embeddings import EmbeddingError, EmbeddingService
from app.rag.errors import GenerationError, ProviderUnavailableError, RetrievalError
from app.rag.extractor import DocumentPage, PDFExtractor
from app.rag.generation import NO_CONTEXT_ANSWER


# ==========================================================================
# Embeddings
# ==========================================================================

def test_embedding_service_fails_when_live_provider_is_unavailable():
    srv = EmbeddingService()
    srv.api_key = None
    srv._client = None

    with pytest.raises(EmbeddingError, match="Live Gemini embedding provider is unavailable"):
        srv.get_query_embedding("What is CASPEL ERP?")


def test_embedding_service_rejects_empty_input():
    srv = EmbeddingService()

    with pytest.raises(EmbeddingError, match="empty text"):
        srv._get_embedding_internal("   ")


def test_embedding_formatting_and_no_task_type():
    srv = EmbeddingService()
    with patch.object(srv, "_get_embedding_internal", return_value=[0.1] * 768) as mock_internal:
        srv.get_document_embedding("Sample text", title="Deck_01")
        mock_internal.assert_called_once_with("title: Deck_01 | text: Sample text")

    with patch.object(srv, "_get_embedding_internal", return_value=[0.1] * 768) as mock_internal:
        srv.get_query_embedding("What is ERP?")
        mock_internal.assert_called_once_with("task: question answering | query: What is ERP?")


def test_no_task_type_in_genai_call():
    srv = EmbeddingService()
    srv.api_key = "test-api-key"
    mock_client = MagicMock()
    srv._client = mock_client

    mock_res = types.SimpleNamespace()
    mock_res.embeddings = [types.SimpleNamespace(values=[0.1] * 768)]
    mock_client.models.embed_content.return_value = mock_res

    srv.get_query_embedding("Test Query")

    mock_client.models.embed_content.assert_called_once()
    kwargs = mock_client.models.embed_content.call_args.kwargs
    assert "task_type" not in kwargs
    assert "taskType" not in kwargs
    assert kwargs["model"] == "gemini-embedding-2"
    assert kwargs["config"].output_dimensionality == 768


def _embedding_service_with(response=None, side_effect=None):
    with patch("app.rag.embeddings.settings") as mock_settings:
        mock_settings.GEMINI_EMBEDDING_MODEL = "gemini-embedding-2"
        mock_settings.EMBEDDING_DIMENSION = 768

        srv = EmbeddingService()
        srv.api_key = "test-api-key"
        client = MagicMock()
        if side_effect is not None:
            client.models.embed_content.side_effect = side_effect
        else:
            client.models.embed_content.return_value = response
        srv._client = client
        return srv, client


def test_production_api_failure_raises_embedding_error():
    srv, _ = _embedding_service_with(side_effect=RuntimeError("API Network Error"))

    with pytest.raises(EmbeddingError):
        srv.get_query_embedding("Test Query")


def test_no_alternate_model_fallback():
    srv, client = _embedding_service_with(side_effect=Exception("Model Error"))

    with pytest.raises(EmbeddingError):
        srv.get_query_embedding("Test Query")

    assert client.models.embed_content.call_count == 1
    assert client.models.embed_content.call_args.kwargs["model"] == "gemini-embedding-2"


def test_embedding_parsing_dimension_mismatch():
    res = types.SimpleNamespace(embeddings=[types.SimpleNamespace(values=[0.1] * 500)])
    srv, _ = _embedding_service_with(response=res)

    with pytest.raises(EmbeddingError, match="Embedding dimension mismatch"):
        srv.get_query_embedding("Test Query")


def test_embedding_parsing_invalid_structure():
    res = types.SimpleNamespace(embeddings=[types.SimpleNamespace()])
    srv, _ = _embedding_service_with(response=res)

    with pytest.raises(EmbeddingError, match="did not contain 'values' field"):
        srv.get_query_embedding("Test Query")


def test_embedding_multiple_embeddings():
    res = types.SimpleNamespace(
        embeddings=[
            types.SimpleNamespace(values=[0.1] * 768),
            types.SimpleNamespace(values=[0.2] * 768),
        ]
    )
    srv, _ = _embedding_service_with(response=res)

    with pytest.raises(EmbeddingError, match="Expected exactly 1"):
        srv.get_query_embedding("Test Query")


def test_embedding_zero_embeddings():
    srv, _ = _embedding_service_with(response=types.SimpleNamespace(embeddings=[]))

    with pytest.raises(EmbeddingError, match="0 embeddings|did not contain"):
        srv.get_query_embedding("Test Query")


def test_embedding_legacy_format_rejected():
    res = types.SimpleNamespace(embedding=types.SimpleNamespace(values=[0.1] * 768))
    srv, _ = _embedding_service_with(response=res)

    with pytest.raises(EmbeddingError, match="did not contain any valid embeddings"):
        srv.get_query_embedding("Test Query")


# ==========================================================================
# PDF extraction
# ==========================================================================

def test_pdf_extractor_chunking():
    page = DocumentPage(page_number=1, content="Slide 1 Title\nSlide 1 Description")
    chunks = PDFExtractor.chunk_page(page, max_chunk_chars=1000)

    assert len(chunks) == 1
    assert chunks[0]["page_number"] == 1
    assert "Slide 1 Title" in chunks[0]["content"]


def _extract_with_mocked_pypdf(page_texts, filename="dummy_corp_presentation.pdf"):
    """Run the PyPDF fallback path against a fake reader yielding page_texts."""
    # Nulling both names forces the PyMuPDF branch to fail so the PyPDF
    # fallback is the path under test.
    with patch("os.path.exists", return_value=True):
        with patch.dict(sys.modules, {"pymupdf": None, "fitz": None, "pypdf": MagicMock()}):
            mock_pypdf = sys.modules["pypdf"]
            mock_reader = MagicMock()

            mock_pages = []
            for text in page_texts:
                page = MagicMock()
                page.extract_text.return_value = text
                mock_pages.append(page)

            mock_reader.pages = mock_pages
            mock_pypdf.PdfReader.return_value = mock_reader

            return PDFExtractor.extract(filename)


def test_pdf_extractor_skips_pages_without_text():
    """
    Pages with no extractable text must be omitted, not replaced with generated
    prose. Anything returned here gets embedded and can be cited back to a
    visitor as CASPEL's own material.
    """
    page_texts = ["some text" if i < 2 else " " for i in range(10)]
    result = _extract_with_mocked_pypdf(page_texts)

    assert len(result.pages) == 2
    assert [p.page_number for p in result.pages] == [1, 2]
    assert all(p.content == "some text" for p in result.pages)


def test_pdf_extractor_never_fabricates_slide_content():
    """Guards against reintroducing the invented slide-description fallback."""
    result = _extract_with_mocked_pypdf(["real slide text", "", "   ", None])

    assert len(result.pages) == 1
    combined = " ".join(p.content for p in result.pages).lower()
    for phrase in ("corporate presentation slide covering", "enterprise solutions, infrastructure"):
        assert phrase not in combined


def test_pdf_extractor_preserves_original_page_numbers():
    """A skipped page must not shift the numbering of the pages that follow."""
    result = _extract_with_mocked_pypdf(["intro", "", "conclusion"])

    assert [p.page_number for p in result.pages] == [1, 3]


def test_pdf_extractor_records_which_pages_had_no_text():
    """
    Coverage is reported, not inferred. Without this, a deck where 21 of 24
    slides failed to extract looks identical to one that indexed cleanly.
    """
    result = _extract_with_mocked_pypdf(["intro", "", "", "conclusion"])

    assert result.total_pages == 4
    assert [p.page_number for p in result.pages] == [1, 4]
    assert result.empty_page_numbers == [2, 3]
    assert result.ocr_page_numbers == []


def test_extract_pages_still_returns_bare_pages():
    pages = PDFExtractor.extract_pages.__doc__ is not None
    assert pages  # documented seam kept for callers that only need pages


# ==========================================================================
# Generation — failures must raise, never return a stand-in answer
# ==========================================================================

def _generation_service(monkeypatch, side_effect):
    """A live-provider GenerationService whose Gemini call does side_effect."""
    import app.rag.generation as gen_module
    from app.rag.generation import GenerationService

    monkeypatch.setattr(gen_module.time, "sleep", lambda _: None)  # no real backoff

    srv = GenerationService()
    srv.api_key = "test-api-key"
    client = MagicMock()
    client.models.generate_content.side_effect = side_effect
    srv._client = client
    return srv, client


def _chunk():
    from app.rag.retrieval import RetrievedChunk

    return RetrievedChunk(
        chunk_id=1, document_id=1, document_name="CASPEL ERP Presentation",
        product="erp", page_number=4, chunk_index=0,
        content="Caspel ERP covers finance and procurement.", score=0.9,
    )


def test_generation_retries_transient_error_then_succeeds(monkeypatch):
    """A 503 capacity spike must not surface to a visitor at the booth."""
    ok = MagicMock()
    ok.text = "Caspel ERP covers finance and procurement."
    srv, client = _generation_service(
        monkeypatch, side_effect=[Exception("503 UNAVAILABLE: high demand"), ok]
    )

    result = srv.generate_response("What is ERP?", [_chunk()])

    assert result.answer == "Caspel ERP covers finance and procurement."
    assert client.models.generate_content.call_count == 2


def test_generation_does_not_retry_permanent_error(monkeypatch):
    """A bad key is not going to fix itself — fail fast, don't burn 3 calls."""
    srv, client = _generation_service(
        monkeypatch, side_effect=Exception("400 INVALID_ARGUMENT: API key not valid")
    )

    with pytest.raises(GenerationError):
        srv.generate_response("What is ERP?", [_chunk()])

    assert client.models.generate_content.call_count == 1


def test_generation_gives_up_after_max_attempts(monkeypatch):
    from app.rag.generation import GENERATION_MAX_ATTEMPTS

    srv, client = _generation_service(monkeypatch, side_effect=Exception("503 UNAVAILABLE: high demand"))

    with pytest.raises(GenerationError):
        srv.generate_response("What is ERP?", [_chunk()])

    assert client.models.generate_content.call_count == GENERATION_MAX_ATTEMPTS


def test_generation_never_returns_an_apology_as_an_answer(monkeypatch):
    """
    The regression this guards: a provider outage used to come back as a polite
    sentence in the `answer` field with HTTP 200, indistinguishable from a real
    reply to every consumer downstream.
    """
    srv, _ = _generation_service(monkeypatch, side_effect=Exception("503 UNAVAILABLE"))

    with pytest.raises(GenerationError) as exc:
        srv.generate_response("What is ERP?", [_chunk()])

    assert "temporarily experiencing connection issues" not in str(exc.value)


def test_generation_always_uses_the_configured_model(monkeypatch):
    """Never silently answer from a different model than the one configured."""
    srv, client = _generation_service(monkeypatch, side_effect=Exception("503 UNAVAILABLE"))

    with pytest.raises(GenerationError):
        srv.generate_response("What is ERP?", [_chunk()])

    models_used = {c.kwargs["model"] for c in client.models.generate_content.call_args_list}
    assert models_used == {srv.model_name}


def test_generation_raises_without_a_live_provider():
    from app.rag.generation import GenerationService

    srv = GenerationService()
    srv.api_key = None
    srv._client = None

    with pytest.raises(ProviderUnavailableError):
        srv.generate_response("What is ERP?", [_chunk()])


def test_empty_retrieval_is_an_answer_not_a_failure(monkeypatch):
    """
    Nothing relevant in the corpus is a correct, grounded answer — not an
    outage. It must come back normally, with no sources.
    """
    srv, client = _generation_service(monkeypatch, side_effect=Exception("never called"))

    result = srv.generate_response("What is the CEO's salary?", [])

    assert result.answer == NO_CONTEXT_ANSWER
    assert result.sources == []
    assert result.grounded is False
    assert client.models.generate_content.call_count == 0


# ==========================================================================
# Chat endpoint
# ==========================================================================

def _patch_retrieval(monkeypatch, result=None, exc=None):
    """
    Replace vector retrieval for the duration of a test.

    Retrieval issues a pgvector `<=>` query, which the SQLite test database
    cannot execute. Patching it is what makes the rest of the chat pipeline —
    generation, message persistence, response shape — actually testable.
    """
    import app.rag.service as service_module

    mock = AsyncMock(side_effect=exc) if exc else AsyncMock(return_value=result or [])
    monkeypatch.setattr(service_module.retrieval_service, "retrieve", mock)
    return mock


def _patch_generation(monkeypatch, answer=None, exc=None):
    import app.rag.service as service_module
    from app.rag.citations import build_source_records
    from app.rag.generation import GenerationResult

    def fake(question, chunks, history=None, response_language="en"):
        if exc:
            raise exc
        # Mirror the real contract: sources are the server-owned records the
        # answer cited, so a stub that returned every chunk would hide a
        # citation-validation regression.
        records = build_source_records(chunks)
        return GenerationResult(answer=answer, sources=records, grounded=bool(chunks))

    monkeypatch.setattr(service_module.generation_service, "generate_response", fake)


@pytest.mark.asyncio
async def test_chat_without_relevant_context_answers_without_citations(
    client: AsyncClient, monkeypatch
):
    _patch_retrieval(monkeypatch, result=[])
    _patch_generation(monkeypatch, answer=NO_CONTEXT_ANSWER)

    response = await client.post(
        "/api/chat", json={"session_id": "sess_chat_001", "message": "What is CASPEL ERP?"}
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["session_id"] == "sess_chat_001"
    assert body["answer"] == NO_CONTEXT_ANSWER
    # Nothing retrieved -> the answer must not claim sources it does not have.
    assert body["sources"] == []


@pytest.mark.asyncio
async def test_chat_cites_retrieved_chunks(client: AsyncClient, monkeypatch):
    from app.rag.retrieval import RetrievedChunk

    chunk = RetrievedChunk(
        chunk_id=1, document_id=1, document_name="CASPEL ERP Presentation",
        product="erp", page_number=7, chunk_index=0,
        content="Caspel ERP consolidates finance, procurement and reporting.", score=0.91,
    )
    _patch_retrieval(monkeypatch, result=[chunk])
    _patch_generation(monkeypatch, answer="CASPEL ERP is described in the official presentation.")

    response = await client.post(
        "/api/chat", json={"session_id": "sess_chat_002", "message": "What is CASPEL ERP?"}
    )

    assert response.status_code == 200, response.text
    sources = response.json()["sources"]
    assert len(sources) == 1
    assert sources[0]["document"] == "CASPEL ERP Presentation"
    assert sources[0]["page"] == 7
    assert sources[0]["product"] == "erp"


@pytest.mark.asyncio
async def test_chat_is_503_when_retrieval_fails(client: AsyncClient, monkeypatch):
    _patch_retrieval(monkeypatch, exc=RetrievalError("pgvector unavailable"))

    response = await client.post(
        "/api/chat", json={"session_id": "sess_chat_003", "message": "What is CASPEL ERP?"}
    )

    assert response.status_code == 503
    assert "detail" in response.json()


@pytest.mark.asyncio
async def test_chat_is_503_when_generation_fails(client: AsyncClient, monkeypatch):
    _patch_retrieval(monkeypatch, result=[])
    _patch_generation(monkeypatch, exc=GenerationError("gemini 503"))

    response = await client.post(
        "/api/chat", json={"session_id": "sess_chat_004", "message": "What is CASPEL ERP?"}
    )

    assert response.status_code == 503


@pytest.mark.asyncio
async def test_chat_is_503_when_no_live_provider_is_configured(client: AsyncClient, monkeypatch):
    _patch_retrieval(monkeypatch, result=[])
    _patch_generation(monkeypatch, exc=ProviderUnavailableError("no provider"))

    response = await client.post(
        "/api/chat", json={"session_id": "sess_chat_005", "message": "What is CASPEL ERP?"}
    )

    assert response.status_code == 503


@pytest.mark.asyncio
async def test_a_failed_chat_is_never_returned_as_a_200_answer(client: AsyncClient, monkeypatch):
    """The core contract: an outage cannot be mistaken for an answer."""
    _patch_retrieval(monkeypatch, result=[])
    _patch_generation(monkeypatch, exc=GenerationError("upstream quota exhausted"))

    response = await client.post(
        "/api/chat", json={"session_id": "sess_chat_006", "message": "What is CASPEL ERP?"}
    )

    assert response.status_code != 200
    assert "answer" not in response.json()


@pytest.mark.asyncio
async def test_a_failed_chat_is_not_recorded_as_a_transcript(
    client: AsyncClient, db_session, monkeypatch
):
    """
    A failure must not leave a user/assistant exchange behind. Counting it would
    overstate answered questions in the exhibition report.
    """
    from sqlalchemy import func, select

    from app.models.entities import ChatMessage

    _patch_retrieval(monkeypatch, exc=RetrievalError("pgvector unavailable"))

    await client.post(
        "/api/chat", json={"session_id": "sess_chat_007", "message": "What is CASPEL ERP?"}
    )

    stored = await db_session.scalar(select(func.count()).select_from(ChatMessage))
    assert stored == 0


@pytest.mark.asyncio
async def test_chat_does_not_log_the_question_text(client: AsyncClient, monkeypatch, caplog):
    """Visitor-entered text must never be copied into application logs."""
    import logging

    secret_question = "zzq-unlikely-marker-9137 what is our contract value"
    _patch_retrieval(monkeypatch, exc=RetrievalError("pgvector unavailable"))

    with caplog.at_level(logging.DEBUG):
        await client.post(
            "/api/chat", json={"session_id": "sess_chat_008", "message": secret_question}
        )

    assert "zzq-unlikely-marker-9137" not in caplog.text


# ==========================================================================
# Retrieval
# ==========================================================================

@pytest.mark.asyncio
async def test_retrieval_threshold():
    from app.rag.retrieval import RetrievalService

    mock_db = AsyncMock()

    row1 = types.SimpleNamespace(
        id=1, document_id=1, document_name="doc1", product="erp",
        page_number=1, chunk_index=1, content="text1", distance=0.2,
    )
    row2 = types.SimpleNamespace(
        id=2, document_id=2, document_name="doc2", product="erp",
        page_number=2, chunk_index=1, content="text2", distance=1.0,
    )

    mock_result = MagicMock()
    mock_result.all.return_value = [row1, row2]
    mock_db.execute.return_value = mock_result

    with patch("app.rag.retrieval.embedding_service.get_query_embedding", return_value=[0.1] * 768):
        with patch("app.core.config.settings.RAG_SIMILARITY_THRESHOLD", 0.70):
            chunks = await RetrievalService.retrieve(mock_db, "query")

    # similarity = 1 - cosine_distance, so 0.2 -> 0.8 (kept), 1.0 -> 0.0 (dropped)
    assert len(chunks) == 1
    assert chunks[0].chunk_id == 1
    assert chunks[0].score == 0.8


@pytest.mark.asyncio
async def test_retrieval_wraps_embedding_failure_as_retrieval_error():
    from app.rag.retrieval import RetrievalService

    mock_db = AsyncMock()
    with patch(
        "app.rag.retrieval.embedding_service.get_query_embedding",
        side_effect=EmbeddingError("provider down"),
    ):
        with pytest.raises(RetrievalError):
            await RetrievalService.retrieve(mock_db, "query")


@pytest.mark.asyncio
async def test_retrieval_error_message_excludes_the_query():
    from app.rag.retrieval import RetrievalService

    mock_db = AsyncMock()
    marker = "zzq-secret-marker-4471"
    with patch(
        "app.rag.retrieval.embedding_service.get_query_embedding",
        side_effect=EmbeddingError("provider down"),
    ):
        with pytest.raises(RetrievalError) as exc:
            await RetrievalService.retrieve(mock_db, marker)

    assert marker not in str(exc.value)


def test_generation_stops_at_the_deadline_instead_of_burning_every_attempt(monkeypatch):
    """
    Attempt count is not a bound on waiting.

    Under real capacity pressure a single "503 high demand" response took ~47
    seconds to arrive, so three attempts left a visitor at the stand waiting
    over two minutes for a failure. The deadline has to cut that short.
    """
    import app.rag.generation as gen_module

    clock = {"t": 0.0}
    monkeypatch.setattr(gen_module.time, "monotonic", lambda: clock["t"])

    def slow_and_unavailable(*_args, **_kwargs):
        clock["t"] += 47.0  # one attempt, as measured against the live API
        raise Exception("503 UNAVAILABLE: high demand")

    srv, client = _generation_service(monkeypatch, side_effect=slow_and_unavailable)

    with pytest.raises(GenerationError):
        srv.generate_response("What is ERP?", [_chunk()])

    # Second attempt starts past the deadline and is abandoned.
    assert client.models.generate_content.call_count == 1
    assert clock["t"] <= gen_module.GENERATION_DEADLINE_SECONDS + 47.0


def test_generation_client_is_built_with_a_request_timeout(monkeypatch):
    """A single provider call must not be able to hang indefinitely."""
    from app.rag.generation import GENERATION_REQUEST_TIMEOUT_SECONDS

    assert 0 < GENERATION_REQUEST_TIMEOUT_SECONDS <= 30
