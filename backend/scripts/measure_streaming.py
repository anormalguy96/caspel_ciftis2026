"""Measure streaming against non-streaming on the live provider.

Bounded: a fixed, small set of questions, one pass each, no retry. Reports
time-to-first-token, total latency and token usage. Prints no answer text, no
question beyond a short label, and no key.

The point is to replace an assumed improvement with a measured one. Streaming
cannot make generation faster; it can only start showing it sooner. Whether
that is worth the added failure modes is what these numbers decide.

    python -m scripts.measure_streaming
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, "/app")

QUESTIONS = [
    ("corporate", "How many years of experience does CASPEL have?"),
    ("erp", "Which modules does Caspel ERP include?"),
    ("chinese", "CASPEL 提供哪些网络安全服务?"),
]


async def main() -> int:
    from app.core.config import settings  # noqa: PLC0415
    from app.core.database import AsyncSessionLocal  # noqa: PLC0415
    from app.rag.citations import strip_citation_markers  # noqa: PLC0415
    from app.rag.generation import generation_service  # noqa: PLC0415
    from app.rag.language import resolve_response_language  # noqa: PLC0415
    from app.rag.retrieval import RetrievalService  # noqa: PLC0415

    if not generation_service.is_live_provider:
        print("  NOT VERIFIED: no live provider configured")
        return 2

    print(f"  model: {settings.GEMINI_CHAT_MODEL}")
    print(f"  context mode: {settings.AI_CONTEXT_MODE}")
    print()
    print(f"  {'case':<12} {'arm':<14} {'TTFT ms':>9} {'total ms':>9} {'chars':>7}")
    print(f"  {'-'*12} {'-'*14} {'-'*9} {'-'*9} {'-'*7}")

    results = []
    async with AsyncSessionLocal() as db:
        for label, question in QUESTIONS:
            lang = resolve_response_language(question, None)
            chunks = await RetrievalService.retrieve(db, question)

            # --- non-streaming -------------------------------------------
            t0 = time.perf_counter()
            try:
                result = await asyncio.to_thread(
                    generation_service.generate_response, question, chunks, None, lang
                )
                total_ns = (time.perf_counter() - t0) * 1000
                chars_ns = len(result.answer)
                # Nothing is visible until the whole response lands, so the
                # first token and the last arrive together by definition.
                ttft_ns = total_ns
            except Exception as exc:  # noqa: BLE001
                print(f"  {label:<12} {'non-streaming':<14} FAILED ({type(exc).__name__})")
                continue

            print(f"  {label:<12} {'non-streaming':<14} {ttft_ns:>9.0f} {total_ns:>9.0f} {chars_ns:>7}")

            # --- streaming -----------------------------------------------
            t0 = time.perf_counter()
            ttft_s = None
            collected = []
            try:
                _records, chunk_iter = await asyncio.to_thread(
                    generation_service.stream_response, question, chunks, lang, None
                )

                def drain():
                    nonlocal ttft_s
                    for piece in chunk_iter:
                        if ttft_s is None:
                            ttft_s = (time.perf_counter() - t0) * 1000
                        collected.append(piece)

                await asyncio.to_thread(drain)
                total_s = (time.perf_counter() - t0) * 1000
                chars_s = len(strip_citation_markers("".join(collected)))
            except Exception as exc:  # noqa: BLE001
                print(f"  {label:<12} {'streaming':<14} FAILED ({type(exc).__name__})")
                continue

            print(f"  {label:<12} {'streaming':<14} {ttft_s or 0:>9.0f} {total_s:>9.0f} {chars_s:>7}")

            results.append(
                {
                    "case": label,
                    "non_streaming_total_ms": round(total_ns),
                    "streaming_ttft_ms": round(ttft_s or 0),
                    "streaming_total_ms": round(total_s),
                }
            )

    if results:
        avg_ns = sum(r["non_streaming_total_ms"] for r in results) / len(results)
        avg_ttft = sum(r["streaming_ttft_ms"] for r in results) / len(results)
        avg_s = sum(r["streaming_total_ms"] for r in results) / len(results)
        print()
        print(f"  mean non-streaming, nothing visible until : {avg_ns:,.0f} ms")
        print(f"  mean streaming, first token visible at    : {avg_ttft:,.0f} ms")
        print(f"  mean streaming, completed at              : {avg_s:,.0f} ms")
        if avg_ns > 0:
            print(
                f"  first content appears {avg_ns - avg_ttft:,.0f} ms sooner "
                f"({(avg_ns - avg_ttft) / avg_ns * 100:.0f}% of the old wait removed)"
            )
        print("  note: total generation time is not reduced; only the wait before")
        print("        anything is visible.")

    Path("/tmp/streaming_measurements.json").write_text(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
