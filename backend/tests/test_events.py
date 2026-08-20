import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_record_analytics_event(client: AsyncClient):
    payload = {
        "session_id": "sess_test_123456",
        "event_name": "ERP_CLICK",
        "product": "erp",
        "metadata": {"screen": "landing", "device": "mobile"},
    }
    response = await client.post("/api/events", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["success"] is True


@pytest.mark.asyncio
async def test_record_analytics_event_minimal(client: AsyncClient):
    payload = {
        "session_id": "sess_test_landing",
        "event_name": "LANDING_OPEN",
    }
    response = await client.post("/api/events", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["success"] is True
