"""Deterministic retrieval evaluator for the approved CASPEL corpus.

Read-only. It embeds each evaluation query, runs the retrieval path under test,
and scores the ranking against expectations recorded in ``corpus.json``.

No LLM judges the output. Every metric here is arithmetic over document/page
identity, so two runs on the same index give the same numbers.

Deliberately never printed: chunk text, full queries beyond a short label,
prompts, provider responses, API keys. The queries themselves are authored
fixtures rather than visitor input, but the same discipline is kept so this
file can never become the thing that leaks a transcript.

Usage (inside the backend container):

    python -m tests.rag_eval.evaluate --split accept
    python -m tests.rag_eval.evaluate --split tune --json /tmp/out.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

CORPUS_PATH = Path(__file__).with_name("corpus.json")


def load_cases(split: Optional[str]) -> tuple[dict, List[dict]]:
    data = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
    cases = data["cases"]
    if split and split != "all":
        cases = [c for c in cases if c.get("split") == split]
    return data, cases


def _page_hit(rows: Sequence[Any], case: dict, cutoff: int) -> bool:
    """Did any of the first ``cutoff`` results land on an expected page?"""
    want_product = case.get("expect_product")
    want_pages = set(case.get("expect_pages") or [])
    if not want_pages:
        return False
    for row in rows[:cutoff]:
        if want_product and row.product != want_product:
            continue
        if row.page_number in want_pages:
            return True
    return False


def _reciprocal_rank(rows: Sequence[Any], case: dict) -> float:
    want_product = case.get("expect_product")
    want_pages = set(case.get("expect_pages") or [])
    if not want_pages:
        return 0.0
    for i, row in enumerate(rows, start=1):
        if want_product and row.product != want_product:
            continue
        if row.page_number in want_pages:
            return 1.0 / i
    return 0.0


async def run(split: Optional[str], out_path: Optional[str], pool: int) -> int:
    sys.path.insert(0, "/app")
    from app.core.database import AsyncSessionLocal  # noqa: PLC0415
    from app.rag.retrieval import RetrievalService  # noqa: PLC0415
    from app.core.config import settings  # noqa: PLC0415

    data, cases = load_cases(split)
    answerable = [c for c in cases if c["answerable"]]
    negatives = [c for c in cases if not c["answerable"]]
    followups = [c for c in cases if c.get("prior_user_turns")]

    results: List[dict] = []
    latencies: List[float] = []

    async with AsyncSessionLocal() as db:
        for case in cases:
            started = time.perf_counter()
            try:
                rows = await RetrievalService.retrieve(
                    db,
                    case["query"],
                    top_k=pool,
                    prior_user_turns=case.get("prior_user_turns"),
                )
                error = None
            except TypeError:
                # Baseline signature has no follow-up support yet.
                rows = await RetrievalService.retrieve(db, case["query"], top_k=pool)
                error = None
            except Exception as exc:  # noqa: BLE001
                rows, error = [], type(exc).__name__
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            latencies.append(elapsed_ms)

            results.append(
                {
                    "id": case["id"],
                    "language": case["language"],
                    "answerable": case["answerable"],
                    "returned": len(rows),
                    "recall_at_4": _page_hit(rows, case, 4),
                    "recall_at_8": _page_hit(rows, case, 8),
                    "rr": _reciprocal_rank(rows, case),
                    "top_product": rows[0].product if rows else None,
                    "top_page": rows[0].page_number if rows else None,
                    "latency_ms": round(elapsed_ms, 1),
                    "error": error,
                    "is_followup": bool(case.get("prior_user_turns")),
                }
            )

    by_id = {r["id"]: r for r in results}

    def pct(n: int, d: int) -> float:
        return round(100.0 * n / d, 1) if d else 0.0

    ans_ids = [c["id"] for c in answerable]
    recall4 = pct(sum(by_id[i]["recall_at_4"] for i in ans_ids), len(ans_ids))
    recall8 = pct(sum(by_id[i]["recall_at_8"] for i in ans_ids), len(ans_ids))
    mrr = round(statistics.fmean([by_id[i]["rr"] for i in ans_ids]), 4) if ans_ids else 0.0

    # A negative case is correct when retrieval returns nothing to ground on.
    neg_ids = [c["id"] for c in negatives]
    neg_ok = sum(1 for i in neg_ids if by_id[i]["returned"] == 0)
    neg_precision = pct(neg_ok, len(neg_ids))

    fu_ids = [c["id"] for c in followups if c["answerable"]]
    fu_ok = sum(1 for i in fu_ids if by_id[i]["recall_at_4"])
    fu_rate = pct(fu_ok, len(fu_ids))

    langs = sorted({c["language"] for c in answerable})
    per_lang = {}
    for lang in langs:
        ids = [c["id"] for c in answerable if c["language"] == lang]
        per_lang[lang] = {
            "n": len(ids),
            "recall_at_4": pct(sum(by_id[i]["recall_at_4"] for i in ids), len(ids)),
            "recall_at_8": pct(sum(by_id[i]["recall_at_8"] for i in ids), len(ids)),
        }

    lat_sorted = sorted(latencies)

    def q(p: float) -> float:
        if not lat_sorted:
            return 0.0
        idx = min(len(lat_sorted) - 1, int(round(p * (len(lat_sorted) - 1))))
        return round(lat_sorted[idx], 1)

    summary = {
        "split": split or "all",
        "threshold": settings.RAG_SIMILARITY_THRESHOLD,
        "pool": pool,
        "cases": len(cases),
        "answerable": len(answerable),
        "negatives": len(negatives),
        "followups": len(fu_ids),
        "recall_at_4": recall4,
        "recall_at_8": recall8,
        "mrr": mrr,
        "no_context_precision": neg_precision,
        "followup_resolution": fu_rate,
        "per_language": per_lang,
        "latency_ms": {"p50": q(0.50), "p90": q(0.90), "max": q(1.0)},
    }

    w = 34
    print(f"  {'split':<{w}} {summary['split']}")
    print(f"  {'cases (answerable/negative)':<{w}} {len(cases)} ({len(answerable)}/{len(negatives)})")
    print(f"  {'similarity threshold':<{w}} {summary['threshold']}")
    print(f"  {'Recall@4':<{w}} {recall4}%")
    print(f"  {'Recall@8':<{w}} {recall8}%")
    print(f"  {'MRR':<{w}} {mrr}")
    print(f"  {'no-context precision (negatives)':<{w}} {neg_precision}%")
    print(f"  {'follow-up resolution':<{w}} {fu_rate}%  (n={len(fu_ids)})")
    print(f"  {'latency p50/p90/max ms':<{w}} {q(0.5)} / {q(0.9)} / {q(1.0)}")
    print(f"  {'per-language Recall@4':<{w}} " + "  ".join(
        f"{k}:{v['recall_at_4']}%(n={v['n']})" for k, v in per_lang.items()))

    misses = [r for r in results if r["answerable"] and not r["recall_at_4"]]
    if misses:
        print(f"\n  Recall@4 misses ({len(misses)}):")
        for r in misses:
            got = f"{r['top_product']}/p{r['top_page']}" if r["top_page"] else "nothing"
            print(f"    {r['id']:<26} returned={r['returned']:<3} top={got}")

    bad_neg = [r for r in results if not r["answerable"] and r["returned"] > 0]
    if bad_neg:
        print(f"\n  negatives that wrongly retrieved context ({len(bad_neg)}):")
        for r in bad_neg:
            print(f"    {r['id']:<26} returned={r['returned']}  top={r['top_product']}/p{r['top_page']}")

    if out_path:
        Path(out_path).write_text(
            json.dumps({"summary": summary, "results": results}, indent=2), encoding="utf-8"
        )

    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Deterministic RAG retrieval evaluation")
    ap.add_argument("--split", default="accept", choices=["tune", "accept", "all"])
    ap.add_argument("--json", dest="out", default=None)
    ap.add_argument("--pool", type=int, default=8, help="results requested per query")
    args = ap.parse_args()
    return asyncio.run(run(args.split, args.out, args.pool))


if __name__ == "__main__":
    raise SystemExit(main())
