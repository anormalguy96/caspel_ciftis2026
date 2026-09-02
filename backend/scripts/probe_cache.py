"""Probe whether this model actually caches the full-context prefix.

The published caching table lists per-model minimums for Gemini 3.5 Flash and
others; gemini-3.5-flash-lite is not listed. Rather than assume it inherits a
threshold, this sends the same byte-stable prefix twice and reads what the
provider reports.

A hit is established from usage metadata only. Lower latency on a second call
proves nothing -- it is equally consistent with a warm connection or a quieter
provider.

    python -m scripts.probe_cache
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, "/app")

QUESTIONS = [
    "How many years of experience does CASPEL have?",
    "Which modules does Caspel ERP include?",
    "Does CASPEL offer DDoS protection?",
]


def usage_of(response) -> dict:
    meta = getattr(response, "usage_metadata", None)
    if meta is None:
        return {}
    out = {}
    for field, key in (
        ("prompt_token_count", "input"),
        ("cached_content_token_count", "cached"),
        ("candidates_token_count", "output"),
        ("total_token_count", "total"),
    ):
        value = getattr(meta, field, None)
        out[key] = int(value) if value is not None else None
    return out


async def main() -> int:
    from google.genai import types  # noqa: PLC0415

    from app.core.config import settings  # noqa: PLC0415
    from app.core.database import AsyncSessionLocal  # noqa: PLC0415
    from app.rag.full_context import (  # noqa: PLC0415
        build_corpus_block,
        build_full_context_prompt,
        load_corpus_records,
    )
    from app.rag.generation import (  # noqa: PLC0415
        GENERATION_DEADLINE_SECONDS,
        SYSTEM_PROMPT,
        generation_service,
    )
    from app.rag.language import DEFAULT_RESPONSE_LANGUAGE, language_instruction  # noqa: PLC0415

    if not generation_service.is_live_provider:
        print("  NOT VERIFIED: no live provider configured")
        return 2

    async with AsyncSessionLocal() as db:
        records = await load_corpus_records(db)

    corpus_block = build_corpus_block(records)
    prefix_digest = hash(corpus_block)

    print(f"  model: {settings.GEMINI_CHAT_MODEL}")
    print(f"  corpus prefix chars: {len(corpus_block):,}")
    print()
    print(f"  {'call':<6} {'input':>8} {'cached':>8} {'output':>8} {'ms':>7}  prefix stable")
    print(f"  {'-'*6} {'-'*8} {'-'*8} {'-'*8} {'-'*7}  -------------")

    rows = []
    for index, question in enumerate(QUESTIONS, start=1):
        prompt = build_full_context_prompt(
            corpus_block, question, language_instruction(DEFAULT_RESPONSE_LANGUAGE), None
        )
        # The prefix must be byte-identical across calls or there is nothing to
        # reuse; assert it rather than trust it.
        stable = hash(build_corpus_block(records)) == prefix_digest

        started = time.perf_counter()
        try:
            response = await asyncio.to_thread(
                generation_service._client.models.generate_content,
                model=generation_service.model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    http_options=types.HttpOptions(
                        timeout=int(GENERATION_DEADLINE_SECONDS * 1000)
                    ),
                ),
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  {index:<6} FAILED ({type(exc).__name__})")
            continue

        elapsed = (time.perf_counter() - started) * 1000
        u = usage_of(response)
        rows.append({**u, "ms": round(elapsed), "call": index})
        print(
            f"  {index:<6} {str(u.get('input')):>8} {str(u.get('cached')):>8} "
            f"{str(u.get('output')):>8} {elapsed:>7.0f}  {stable}"
        )

    print()
    if not rows:
        print("  NOT VERIFIED: no successful calls")
        return 1

    cached_values = [r.get("cached") or 0 for r in rows]
    if all(v == 0 for v in cached_values):
        print("  RESULT: no cached tokens reported on any call.")
        print("          Implicit caching is NOT observed for this model at this size.")
    else:
        first, rest = cached_values[0], cached_values[1:]
        best = max(cached_values)
        share = best / max(1, max(r.get("input") or 1 for r in rows)) * 100
        print(f"  RESULT: cached tokens reported. First call {first}, later calls {rest}.")
        print(f"          Peak {best:,} cached of {max(r.get('input') or 0 for r in rows):,} input ({share:.0f}%).")
        print("          Established from usage metadata, not from latency.")

    Path("/tmp/cache_probe.json").write_text(json.dumps(rows, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
