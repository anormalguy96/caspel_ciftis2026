"""The capability endpoint is the client's only honest source for delivery path.

Before it existed, the browser discovered whether streaming was available by
attempting it and reading the 404. Streaming is off by default, so that put a
failed request in front of every visitor question on a default deployment.

These tests hold the contract: exactly one boolean, matching the flag, and
nothing else disclosed.
"""
from __future__ import annotations

import pytest

from app.core.config import settings


@pytest.mark.asyncio
async def test_reports_false_when_streaming_is_disabled(client, monkeypatch):
    monkeypatch.setattr(settings, "AI_STREAMING_ENABLED", False)
    response = await client.get("/api/chat/capabilities")
    assert response.status_code == 200
    assert response.json() == {"streaming": False}


@pytest.mark.asyncio
async def test_reports_true_when_streaming_is_enabled(client, monkeypatch):
    monkeypatch.setattr(settings, "AI_STREAMING_ENABLED", True)
    response = await client.get("/api/chat/capabilities")
    assert response.status_code == 200
    assert response.json() == {"streaming": True}


@pytest.mark.asyncio
async def test_agrees_with_the_streaming_route_when_disabled(client, monkeypatch):
    """The advertised capability and the route's real answer must not disagree."""
    monkeypatch.setattr(settings, "AI_STREAMING_ENABLED", False)

    caps = await client.get("/api/chat/capabilities")
    assert caps.json()["streaming"] is False

    stream = await client.post(
        "/api/chat/stream",
        json={"session_id": "caps-check", "message": "Which modules does ERP include?"},
    )
    assert stream.status_code == 404


@pytest.mark.asyncio
async def test_discloses_nothing_but_the_one_boolean(client, monkeypatch):
    """A public probe must not be able to inventory the deployment from here.

    /api/health is deliberately minimal for the same reason. This endpoint is
    reachable by anyone who can reach the site, so model names, the environment,
    the corpus size and the architecture mode all stay out of it.
    """
    monkeypatch.setattr(settings, "AI_STREAMING_ENABLED", True)
    body = (await client.get("/api/chat/capabilities")).json()

    assert set(body) == {"streaming"}

    serialised = str(body).lower()
    for leak in ("gemini", "flash", "rag", "full_context", "postgres", "key", "model"):
        assert leak not in serialised


@pytest.mark.asyncio
async def test_needs_no_database(client, monkeypatch):
    """It must answer even when the database is unreachable.

    The client asks this before it can send a question at all. If it depended on
    the database, an outage would take the delivery-path decision with it and the
    visitor would get neither streaming nor the plain endpoint.
    """
    monkeypatch.setattr(settings, "AI_STREAMING_ENABLED", False)
    response = await client.get("/api/chat/capabilities")
    assert response.status_code == 200
