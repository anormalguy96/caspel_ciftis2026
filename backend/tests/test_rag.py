import pytest
from httpx import AsyncClient
from app.rag.extractor import PDFExtractor, DocumentPage
from app.rag.embeddings import embedding_service


def test_embedding_service_deterministic():
    emb1 = embedding_service.get_embedding("What is CASPEL ERP?")
    emb2 = embedding_service.get_embedding("What is CASPEL ERP?")
    assert len(emb1) == 768
    assert len(emb2) == 768
    assert emb1 == emb2


def test_pdf_extractor_chunking():
    page = DocumentPage(page_number=1, content="Slide 1 Title\nSlide 1 Description")
    chunks = PDFExtractor.chunk_page(page, max_chunk_chars=1000)
    assert len(chunks) == 1
    assert chunks[0]["page_number"] == 1
    assert "Slide 1 Title" in chunks[0]["content"]


@pytest.mark.asyncio
async def test_chat_endpoint_graceful(client: AsyncClient):
    payload = {
        "session_id": "sess_chat_001",
        "message": "What is CASPEL ERP?",
    }
    response = await client.post("/api/chat", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "answer" in data
    assert "sources" in data
    assert data["session_id"] == "sess_chat_001"
