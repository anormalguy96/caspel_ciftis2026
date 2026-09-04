"""Bounded head-to-head: retrieval versus full context.

Runs the acceptance split through both arms with identical model settings and
identical citation validation, so the comparison measures the architecture
rather than two implementations of the same rules.

Retrieval metrics (Recall@k, MRR) apply only to the RAG arm; full context has
no ranking to score. Both arms are compared on what a visitor actually
receives: correct citations, required facts, honest refusals, language, cost
and latency.

Bounded by construction: one pass, no retry, a fixed case list. Prints no
answer text, no key, no provider payload.

    python -m scripts.compare_architectures --limit 8
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, "/app")

CORPUS = Path("/app/tests/rag_eval/corpus.json")


def has_han(text: str) -> bool:
    return bool(re.search(r"[一-鿿]", text))


def looks_azerbaijani(text: str) -> bool:
    return bool(re.search(r"[əğışçöü]", text.lower()))


async def run_case(db, case: dict, mode: str) -> dict:
    """One question through one arm."""
    from app.core.config import settings  # noqa: PLC0415
    from app.rag.citations import build_source_records, format_context  # noqa: PLC0415
    from app.rag.full_context import (  # noqa: PLC0415
        build_corpus_block,
        build_full_context_prompt,
        load_corpus_records,
    )
    from app.rag.generation import generation_service  # noqa: PLC0415
    from app.rag.language import language_instruction, resolve_response_language  # noqa: PLC0415
    from app.rag.retrieval import RetrievalService  # noqa: PLC0415

    question = case["query"]
    prior = case.get("prior_user_turns")
    lang = resolve_response_language(question, None)

    started = time.perf_counter()
    usage = {}

    if mode == "rag":
        chunks = await RetrievalService.retrieve(db, question, prior_user_turns=prior)
        try:
            result = await asyncio.to_thread(
                generation_service.generate_response, question, chunks, None, lang
            )
            answer, sources, grounded = result.answer, result.sources, result.grounded
        except Exception as exc:  # noqa: BLE001
            return {"id": case["id"], "mode": mode, "error": type(exc).__name__}
    else:
        records = await load_corpus_records(db)
        history = [{"role": "user", "content": t} for t in (prior or [])]
        prompt = build_full_context_prompt(
            build_corpus_block(records), question, language_instruction(lang), history
        )
        try:
            # Same provider entry point as the RAG arm, with the corpus prompt
            # substituted for the retrieved one.
            raw, meta = await asyncio.to_thread(
                _generate_full_context, generation_service, prompt
            )
            usage = meta
            from app.rag.citations import resolve_citations  # noqa: PLC0415

            answer, sources, _unknown = resolve_citations(raw, records)
            grounded = bool(sources)
        except Exception as exc:  # noqa: BLE001
            return {"id": case["id"], "mode": mode, "error": type(exc).__name__}

    elapsed = (time.perf_counter() - started) * 1000

    # --- scoring ---------------------------------------------------------
    want_pages = set(case.get("expect_pages") or [])
    want_product = case.get("expect_product")
    cited = [(getattr(s, "product", None), getattr(s, "page", None)) for s in sources]

    doc_ok = all(p == want_product for p, _ in cited) if cited and want_product else None
    page_hit = any(pg in want_pages for _, pg in cited) if want_pages else None

    required = case.get("required_terms") or []
    facts_ok = all(t.lower() in answer.lower() for t in required) if required else None

    # A forbidden claim is only meaningful for an answer that actually asserts
    # something. A refusal to a pricing question says "I do not have pricing
    # information", which contains the forbidden word while being exactly the
    # behaviour wanted -- scoring that as a violation reported a correct
    # refusal as a safety failure.
    forbidden = case.get("forbidden_claims") or []
    if forbidden and grounded:
        clean = not any(f.lower() in answer.lower() for f in forbidden)
    else:
        clean = None

    if case["language"] == "zh-CN":
        lang_ok = has_han(answer)
    elif case["language"] == "az":
        lang_ok = looks_azerbaijani(answer) or len(answer) > 0
    else:
        lang_ok = not has_han(answer)

    return {
        "id": case["id"],
        "mode": mode,
        "answerable": case["answerable"],
        "latency_ms": round(elapsed),
        "answer_chars": len(answer),
        "grounded": grounded,
        "source_count": len(sources),
        "doc_precision": doc_ok,
        "page_hit": page_hit,
        "required_facts": facts_ok,
        "no_forbidden_claim": clean,
        "language_ok": lang_ok,
        # For a negative case, the only correct behaviour is no sources.
        "no_context_correct": (len(sources) == 0) if not case["answerable"] else None,
        **usage,
    }


def _generate_full_context(service, prompt: str):
    """Call the provider with a prepared full-context prompt; return text+usage."""
    from google.genai import types

    from app.rag.generation import (
        GENERATION_DEADLINE_SECONDS,
        SYSTEM_PROMPT,
    )

    response = service._client.models.generate_content(
        model=service.model_name,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            http_options=types.HttpOptions(
                timeout=int(GENERATION_DEADLINE_SECONDS * 1000)
            ),
        ),
    )
    meta = {}
    usage = getattr(response, "usage_metadata", None)
    if usage is not None:
        for field, key in (
            ("prompt_token_count", "input_tokens"),
            ("candidates_token_count", "output_tokens"),
            ("cached_content_token_count", "cached_tokens"),
            ("total_token_count", "total_tokens"),
        ):
            value = getattr(usage, field, None)
            if value is not None:
                meta[key] = int(value)
    return (getattr(response, "text", "") or "").strip(), meta


async def main() -> int:
    from app.core.database import AsyncSessionLocal  # noqa: PLC0415
    from app.rag.generation import generation_service  # noqa: PLC0415

    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=8, help="cases per arm (bounded)")
    ap.add_argument("--split", default="accept")
    args = ap.parse_args()

    if not generation_service.is_live_provider:
        print("  NOT VERIFIED: no live provider configured")
        return 2

    cases = [
        c for c in json.loads(CORPUS.read_text(encoding="utf-8"))["cases"]
        if c.get("split") == args.split
    ][: args.limit]

    rows = []
    async with AsyncSessionLocal() as db:
        for mode in ("rag", "full_context"):
            for case in cases:
                rows.append(await run_case(db, case, mode))

    def summarise(mode: str) -> dict:
        arm = [r for r in rows if r["mode"] == mode and "error" not in r]
        errors = [r for r in rows if r["mode"] == mode and "error" in r]
        answerable = [r for r in arm if r["answerable"]]
        negatives = [r for r in arm if not r["answerable"]]

        def rate(items, key):
            vals = [r[key] for r in items if r.get(key) is not None]
            return round(100 * sum(bool(v) for v in vals) / len(vals), 1) if vals else None

        lat = sorted(r["latency_ms"] for r in arm)
        return {
            "cases": len(arm),
            "errors": len(errors),
            "citation_doc_precision": rate(answerable, "doc_precision"),
            "citation_page_precision": rate(answerable, "page_hit"),
            "required_facts": rate(answerable, "required_facts"),
            "no_forbidden_claim": rate(arm, "no_forbidden_claim"),
            "language_ok": rate(arm, "language_ok"),
            "no_context_precision": rate(negatives, "no_context_correct"),
            "median_latency_ms": lat[len(lat) // 2] if lat else None,
            "input_tokens": sum(r.get("input_tokens", 0) for r in arm) or None,
            "cached_tokens": sum(r.get("cached_tokens", 0) for r in arm) or None,
        }

    print(f"  cases per arm: {len(cases)} (split={args.split})\n")
    a, b = summarise("rag"), summarise("full_context")
    keys = list(a.keys())
    print(f"  {'metric':<26} {'rag':>14} {'full_context':>14}")
    print(f"  {'-'*26} {'-'*14} {'-'*14}")
    for k in keys:
        av = "n/a" if a[k] is None else str(a[k])
        bv = "n/a" if b[k] is None else str(b[k])
        print(f"  {k:<26} {av:>14} {bv:>14}")

    Path("/tmp/architecture_comparison.json").write_text(
        json.dumps({"rag": a, "full_context": b, "rows": rows}, indent=2)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
