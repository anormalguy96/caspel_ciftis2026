"""
Liveness and readiness.

Readiness used to pass on `SELECT count(*) FROM documents > 0`. One arbitrary
row — any name, any path, no chunks, no embeddings — was enough to report a
production knowledge base. These tests require readiness to mean what it says:
every approved deck present by source hash, with chunks, with embeddings, a live
provider, and mock mode off.
"""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.presentations import PRESENTATIONS, REGISTERED_SLUGS
from app.models.entities import Document, DocumentChunk

EMBEDDING_DIM = 768


@pytest.fixture
def live_provider(monkeypatch):
    """Pretend a live Gemini client is configured, without calling Gemini."""
    import app.api.routes as routes

    monkeypatch.setattr(routes.settings, "GEMINI_API_KEY", "test-api-key")
    for service in (routes.embedding_service, routes.generation_service):
        monkeypatch.setattr(service, "api_key", "test-api-key")
        monkeypatch.setattr(service, "_client", object())


async def seed_approved_corpus(
    db: AsyncSession, *, slugs=None, chunks_per_doc=3, embed=True
):
    """Insert a corpus that mirrors a real ingestion run."""
    for slug in slugs if slugs is not None else REGISTERED_SLUGS:
        spec = PRESENTATIONS[slug]
        doc = Document(
            name=spec.name,
            source_path=f"/data/presentations/{spec.filename}",
            product=spec.product,
            source_sha256=spec.sha256,
            source_page_count=spec.page_count,
            pages_with_text=spec.page_count,
            pages_via_ocr=0,
            pages_without_text=0,
        )
        db.add(doc)
        await db.flush()

        for i in range(chunks_per_doc):
            db.add(
                DocumentChunk(
                    document_id=doc.id,
                    page_number=i + 1,
                    chunk_index=0,
                    content=f"{spec.name} slide {i + 1}",
                    embedding=[0.01] * EMBEDDING_DIM if embed else None,
                )
            )
    await db.commit()


# --------------------------------------------------------------------------
# Health
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_health_reports_liveness_only(client: AsyncClient):
    response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


@pytest.mark.asyncio
async def test_health_discloses_no_operational_detail(client: AsyncClient):
    """
    /api/health is publicly reachable. It must not publish the environment name,
    the database topology, model names or corpus statistics.
    """
    body = await client.get("/api/health")
    payload = body.json()

    assert set(payload) == {"status"}
    text = body.text.lower()
    for leak in ("app_env", "postgres", "gemini", "embedding", "model", "database"):
        assert leak not in text


# --------------------------------------------------------------------------
# Readiness
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ready_is_503_with_an_empty_corpus(client: AsyncClient, live_provider):
    response = await client.get("/api/ready")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "not_ready"
    assert body["checks"]["approved_corpus"] is False
    assert body["checks"]["database"] is True


@pytest.mark.asyncio
async def test_ready_when_every_approved_deck_is_indexed(
    client: AsyncClient, db_session: AsyncSession, live_provider
):
    await seed_approved_corpus(db_session)

    response = await client.get("/api/ready")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "ready"
    assert body["checks"] == {
        "database": True,
        "vector_extension": True,
        "live_ai_provider": True,
        "approved_corpus": True,
    }


@pytest.mark.asyncio
async def test_one_arbitrary_document_row_is_not_a_knowledge_base(
    client: AsyncClient, db_session: AsyncSession, live_provider
):
    """The exact condition the previous readiness check accepted."""
    db_session.add(
        Document(name="Something", source_path="/data/presentations/whatever.pdf", product="erp")
    )
    await db_session.commit()

    response = await client.get("/api/ready")

    assert response.status_code == 503
    assert response.json()["checks"]["approved_corpus"] is False


@pytest.mark.asyncio
async def test_ready_refuses_a_partially_indexed_corpus(
    client: AsyncClient, db_session: AsyncSession, live_provider
):
    """One approved deck present is not both of them."""
    await seed_approved_corpus(db_session, slugs=[REGISTERED_SLUGS[0]])

    response = await client.get("/api/ready")

    assert response.status_code == 503
    assert response.json()["checks"]["approved_corpus"] is False


@pytest.mark.asyncio
async def test_ready_refuses_a_document_with_no_chunks(
    client: AsyncClient, db_session: AsyncSession, live_provider
):
    await seed_approved_corpus(db_session, chunks_per_doc=0)

    response = await client.get("/api/ready")

    assert response.status_code == 503
    assert response.json()["checks"]["approved_corpus"] is False


@pytest.mark.asyncio
async def test_ready_refuses_chunks_without_embeddings(
    client: AsyncClient, db_session: AsyncSession, live_provider
):
    """Chunks exist but the embedding pass never landed."""
    await seed_approved_corpus(db_session, embed=False)

    response = await client.get("/api/ready")

    assert response.status_code == 503
    assert response.json()["checks"]["approved_corpus"] is False


@pytest.mark.asyncio
async def test_ready_refuses_a_corpus_built_from_an_unapproved_file(
    client: AsyncClient, db_session: AsyncSession, live_provider
):
    """
    Right document names, right chunk counts, wrong source bytes. This is what a
    recompressed deck would produce, and it must not certify as ready.
    """
    for slug in REGISTERED_SLUGS:
        spec = PRESENTATIONS[slug]
        doc = Document(
            name=spec.name,
            source_path=f"/data/presentations/{spec.filename}",
            product=spec.product,
            source_sha256="0" * 64,
        )
        db_session.add(doc)
        await db_session.flush()
        db_session.add(
            DocumentChunk(
                document_id=doc.id, page_number=1, chunk_index=0,
                content="text", embedding=[0.01] * EMBEDDING_DIM,
            )
        )
    await db_session.commit()

    response = await client.get("/api/ready")

    assert response.status_code == 503
    assert response.json()["checks"]["approved_corpus"] is False


@pytest.mark.asyncio
async def test_ready_refuses_when_no_live_provider_is_configured(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
):
    import app.api.routes as routes

    await seed_approved_corpus(db_session)
    monkeypatch.setattr(routes.settings, "GEMINI_API_KEY", "")
    monkeypatch.setattr(routes.embedding_service, "_client", None)
    monkeypatch.setattr(routes.generation_service, "_client", None)

    response = await client.get("/api/ready")

    assert response.status_code == 503
    assert response.json()["checks"]["live_ai_provider"] is False


@pytest.mark.asyncio
async def test_ready_refuses_without_a_configured_provider(
    client: AsyncClient, db_session: AsyncSession, live_provider, monkeypatch
):
    """
    Readiness reports the real dependencies only.

    The removed ALLOW_MOCK_RAG check was a guard over a path that did not
    exist: no code in app/rag/ ever read it, so it could never have enabled a
    canned answer. What genuinely has to gate readiness is whether a live
    provider is configured at all.
    """
    import app.api.routes as routes

    await seed_approved_corpus(db_session)
    monkeypatch.setattr(routes.settings, "GEMINI_API_KEY", "")

    response = await client.get("/api/ready")

    assert response.status_code == 503
    assert response.json()["checks"]["live_ai_provider"] is False
    assert "mock_mode_disabled" not in response.json()["checks"]


@pytest.mark.asyncio
async def test_ready_discloses_no_model_or_corpus_detail(
    client: AsyncClient, db_session: AsyncSession, live_provider
):
    await seed_approved_corpus(db_session)

    body = await client.get("/api/ready")

    assert set(body.json()) == {"status", "checks"}
    text = body.text.lower()
    for leak in ("gemini", "embedding_model", "postgres", "indexed_documents", "app_env"):
        assert leak not in text


@pytest.mark.asyncio
async def test_root_endpoint(client: AsyncClient):
    response = await client.get("/")

    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "CASPEL CIFTIS 2026 API"
    assert data["status"] == "operational"
