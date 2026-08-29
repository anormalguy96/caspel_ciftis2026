"""
Production configuration and proxy trust.

Two classes of defect covered here:

1. A production process that starts anyway. The old config carried a real
   default database password in source control, so a deployment that forgot to
   set POSTGRES_PASSWORD came up silently protected by a credential published on
   GitHub.

2. A rate limiter that trusts the client. X-Forwarded-For is client-controlled
   for every hop the request has not yet passed through, so taking its first
   entry as the caller's identity lets anyone mint a fresh quota per request.
"""
import pytest

from app.core.config import ConfigurationError, Settings
from app.core.rate_limit import client_key


def prod_settings(**overrides) -> Settings:
    base = dict(
        APP_ENV="production",
        POSTGRES_PASSWORD="a-sufficiently-long-password",
        GEMINI_API_KEY="live-key",
        TRUSTED_PROXY_COUNT=1,
        DATABASE_URL=None,
    )
    base.update(overrides)
    return Settings(**base)


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

def test_there_is_no_hardcoded_database_password_default():
    """A fallback credential in source control is how a dev secret reaches prod."""
    assert Settings.model_fields["POSTGRES_PASSWORD"].default == ""


def test_a_correctly_configured_production_process_starts():
    settings = prod_settings()

    assert settings.production_problems() == []
    settings.enforce_production_config()  # must not raise


def test_production_refuses_an_empty_database_password():
    settings = prod_settings(POSTGRES_PASSWORD="")

    with pytest.raises(ConfigurationError, match="POSTGRES_PASSWORD"):
        settings.enforce_production_config()


def test_production_refuses_a_weak_database_password():
    settings = prod_settings(POSTGRES_PASSWORD="short")

    assert any("POSTGRES_PASSWORD" in p for p in settings.production_problems())


def test_production_refuses_a_missing_gemini_key():
    settings = prod_settings(GEMINI_API_KEY=None)

    with pytest.raises(ConfigurationError, match="GEMINI_API_KEY"):
        settings.enforce_production_config()


def test_production_requires_a_configured_provider():
    """
    The real invariant, now that the dead ALLOW_MOCK_RAG guard is gone.

    That flag never selected a canned-answer path — nothing in app/rag/ ever
    read it. It only refused to start. What actually keeps an unanswerable
    assistant off a stand is this: no key, no production start, and the
    generation service raises rather than inventing a reply.
    """
    settings = prod_settings(GEMINI_API_KEY="")

    with pytest.raises(ConfigurationError, match="GEMINI_API_KEY"):
        settings.enforce_production_config()


def test_production_reports_every_problem_at_once():
    """An operator fixing a stand deployment needs the whole list, not the first."""
    settings = prod_settings(POSTGRES_PASSWORD="", GEMINI_API_KEY="", TRUSTED_PROXY_COUNT=0)

    problems = settings.production_problems()

    assert len(problems) >= 2


def test_development_is_not_blocked_by_the_production_guard():
    settings = Settings(APP_ENV="development", POSTGRES_PASSWORD="")

    settings.enforce_production_config()  # must not raise


def test_cors_is_empty_by_default_in_production():
    """SPA and API share an origin behind nginx; an allowlist is not needed."""
    assert prod_settings().cors_origins == []


def test_cors_uses_the_configured_allowlist_when_supplied():
    settings = prod_settings(CORS_ALLOWED_ORIGINS="https://a.example, https://b.example")

    assert settings.cors_origins == ["https://a.example", "https://b.example"]


# --------------------------------------------------------------------------
# Proxy trust
# --------------------------------------------------------------------------

class FakeRequest:
    def __init__(self, forwarded=None, peer="10.0.0.9"):
        self.headers = {"X-Forwarded-For": forwarded} if forwarded else {}
        self.client = type("C", (), {"host": peer, "port": 0})()
        self.scope = {"client": (peer, 0)}


def test_client_key_uses_the_address_the_trusted_proxy_saw(monkeypatch):
    from app.core import rate_limit

    monkeypatch.setattr(rate_limit.settings, "TRUSTED_PROXY_COUNT", 1)
    # nginx appends the real peer, so the rightmost entry is the trustworthy one.
    request = FakeRequest(forwarded="203.0.113.7")

    assert client_key(request) == "203.0.113.7"


def test_client_key_ignores_a_client_supplied_prefix(monkeypatch):
    """
    The attack the old code enabled: a caller sends a random first entry and
    gets a brand new rate-limit bucket on every request.
    """
    from app.core import rate_limit

    monkeypatch.setattr(rate_limit.settings, "TRUSTED_PROXY_COUNT", 1)

    first = client_key(FakeRequest(forwarded="1.2.3.4, 203.0.113.7"))
    second = client_key(FakeRequest(forwarded="9.9.9.9, 203.0.113.7"))

    assert first == second == "203.0.113.7"


def test_client_key_honours_multiple_trusted_proxies(monkeypatch):
    from app.core import rate_limit

    monkeypatch.setattr(rate_limit.settings, "TRUSTED_PROXY_COUNT", 2)
    request = FakeRequest(forwarded="1.2.3.4, 203.0.113.7, 10.0.0.2")

    assert client_key(request) == "203.0.113.7"


def test_client_key_rejects_a_non_address_value(monkeypatch):
    """A forged header must not become an unbounded key in the limiter store."""
    from app.core import rate_limit

    monkeypatch.setattr(rate_limit.settings, "TRUSTED_PROXY_COUNT", 1)

    assert client_key(FakeRequest(forwarded="not-an-ip", peer="10.0.0.9")) == "10.0.0.9"


def test_client_key_falls_back_to_the_peer_without_the_header(monkeypatch):
    from app.core import rate_limit

    monkeypatch.setattr(rate_limit.settings, "TRUSTED_PROXY_COUNT", 1)

    assert client_key(FakeRequest(peer="198.51.100.4")) == "198.51.100.4"
