"""
One live verification of CASPEL AI, through the real product path.

Run this ONCE, after the Gemini quota/billing issue is resolved. It does not
retry: repeatedly hammering an exhausted quota produces noise, not evidence, and
a single clean pass is what the release gate actually needs.

    docker compose exec -T backend python scripts/verify_gemini_integration.py

It asserts, for each question:

  * HTTP 200 from /api/chat (a provider failure is 503 and fails this check);
  * a non-empty answer;
  * at least one grounded source with a document name and page number;

and reports the measured latency and the configured chat model.

It never prints the API key, and it never prints the prompt actually sent to
Gemini — that prompt embeds slide text from CASPEL's decks, and the visitor's
question is theirs, not log material. Only the short question label, the answer
and the citations are shown.

The chat model is read from configuration and reported, never chosen here. If
the pinned model is unavailable this must FAIL; answering from a substitute
model would mean the verification passed for something other than the
deployment being verified.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import settings  # noqa: E402

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8000").rstrip("/")
TIMEOUT_SECONDS = 90

# One question per approved deck, so a pass proves both are actually retrievable.
QUESTIONS = [
    ("Corporate", "What does CASPEL do as a company?"),
    ("ERP", "What modules does Caspel ERP include?"),
]


def ask(label: str, question: str) -> bool:
    payload = json.dumps(
        {"session_id": "release-verification", "message": question}
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{BASE_URL}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    print(f"--- {label}")
    print(f"    question : {question}")

    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            status = response.status
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        elapsed = time.monotonic() - started
        detail = ""
        try:
            detail = json.loads(exc.read().decode("utf-8")).get("detail", "")
        except Exception:
            pass
        print(f"    HTTP     : {exc.code}  ({elapsed:.1f}s)")
        print(f"    detail   : {detail}")
        print("    VERDICT  : FAIL — the assistant reported itself unavailable")
        return False
    except Exception as exc:
        elapsed = time.monotonic() - started
        print(f"    HTTP     : no response  ({elapsed:.1f}s)")
        print(f"    error    : {type(exc).__name__}")
        print("    VERDICT  : FAIL")
        return False

    elapsed = time.monotonic() - started
    answer = (body.get("answer") or "").strip()
    sources = body.get("sources") or []

    print(f"    HTTP     : {status}  ({elapsed:.1f}s)")
    print(f"    answer   : {len(answer)} chars")
    if answer:
        preview = " ".join(answer.split())
        print(f"    text     : {preview[:400]}{'…' if len(preview) > 400 else ''}")
    print(f"    sources  : {len(sources)}")
    for source in sources:
        print(
            f"       - {source.get('document')}  p.{source.get('page')}"
            f"  score={source.get('score')}"
        )

    problems = []
    if status != 200:
        problems.append(f"HTTP {status}")
    if not answer:
        problems.append("empty answer")
    if not sources:
        problems.append("no grounded sources")
    else:
        for source in sources:
            if not source.get("document") or source.get("page") is None:
                problems.append("a source is missing its document or page")
                break

    if problems:
        print(f"    VERDICT  : FAIL — {'; '.join(problems)}")
        return False

    print("    VERDICT  : PASS — grounded and cited")
    return True


def main() -> int:
    print("=" * 68)
    print("CASPEL AI — live verification (single run, no retries)")
    print("=" * 68)
    print(f"target      : {BASE_URL}/api/chat")
    print(f"chat model  : {settings.GEMINI_CHAT_MODEL}")
    print(f"embed model : {settings.GEMINI_EMBEDDING_MODEL}")
    # Presence only. The value never appears in output.
    print(f"api key     : {'configured' if (settings.GEMINI_API_KEY or '').strip() else 'MISSING'}")

    print("")

    results = [ask(label, question) for label, question in QUESTIONS]

    print("")
    print("=" * 68)
    passed = sum(1 for r in results if r)
    print(f"RESULT: {passed}/{len(results)} question(s) answered with grounded citations")
    print(f"model verified: {settings.GEMINI_CHAT_MODEL}")
    print("=" * 68)
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
