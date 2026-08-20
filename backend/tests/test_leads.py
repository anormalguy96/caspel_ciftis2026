import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_lead_success(client: AsyncClient):
    payload = {
        "name": "Emin Mammadov",
        "company": "CASPEL International Partner",
        "business_email": "emin@example.com",
        "interest": "erp",
    }
    response = await client.post("/api/leads", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["success"] is True
    assert "Thank you" in data["message"]
    assert data["id"] is not None


@pytest.mark.asyncio
async def test_create_lead_invalid_email(client: AsyncClient):
    payload = {
        "name": "Invalid User",
        "company": "Test Org",
        "business_email": "not-an-email",
        "interest": "erp",
    }
    response = await client.post("/api/leads", json=payload)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_lead_invalid_interest(client: AsyncClient):
    payload = {
        "name": "Valid User",
        "company": "Test Org",
        "business_email": "user@company.com",
        "interest": "unsupported_product",
    }
    response = await client.post("/api/leads", json=payload)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_lead_honeypot_discard(client: AsyncClient):
    payload = {
        "name": "Spam Bot",
        "company": "Botnet Inc",
        "business_email": "bot@spammer.org",
        "interest": "erp",
        "honeypot": "i-am-a-bot-filling-hidden-field",
    }
    response = await client.post("/api/leads", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["success"] is True
    # Honeypot silently discards insert without creating an ID
    assert data.get("id") is None
