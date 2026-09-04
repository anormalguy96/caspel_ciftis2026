"""Operator CLI for CASPEL CIFTIS 2026 Exhibition Hub.

Provides a secure, internal administrative interface to inspect and export
leads, visitor chat interactions, and telemetry without exposing an unauthenticated
or public web admin dashboard.

Usage (from host):
    docker compose exec backend python -m scripts.operator summary
    docker compose exec backend python -m scripts.operator leads
    docker compose exec backend python -m scripts.operator leads --csv
    docker compose exec backend python -m scripts.operator chat --limit 20
    docker compose exec backend python -m scripts.operator analytics
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import io
import sys
from datetime import datetime
from typing import Optional

sys.path.insert(0, "/app")

from sqlalchemy import desc, func, select
from app.core.database import AsyncSessionLocal
from app.models.entities import AnalyticsEvent, ChatMessage, ChatSession, Document, Lead


def format_table(headers: list[str], rows: list[list[str]]) -> str:
    """Format tabular data into an aligned ASCII table."""
    if not rows:
        return "(No records found)"
    widths = [len(h) for h in headers]
    for row in rows:
        for i, val in enumerate(row):
            widths[i] = max(widths[i], len(str(val)))

    sep = "+-" + "-+-".join("-" * w for w in widths) + "-+"
    head = "| " + " | ".join(h.ljust(widths[i]) for i, h in enumerate(headers)) + " |"

    body_lines = []
    for row in rows:
        line = "| " + " | ".join(str(val).ljust(widths[i]) for i, val in enumerate(row)) + " |"
        body_lines.append(line)

    return f"{sep}\n{head}\n{sep}\n" + "\n".join(body_lines) + f"\n{sep}"


async def show_summary():
    """Print high-level exhibition dashboard metrics."""
    async with AsyncSessionLocal() as db:
        lead_count = (await db.execute(select(func.count(Lead.id)))).scalar() or 0
        session_count = (await db.execute(select(func.count(ChatSession.id)))).scalar() or 0
        question_count = (
            await db.execute(
                select(func.count(ChatMessage.id)).where(ChatMessage.role == "user")
            )
        ).scalar() or 0
        event_count = (
            await db.execute(select(func.count(AnalyticsEvent.id)))
        ).scalar() or 0
        doc_count = (await db.execute(select(func.count(Document.id)))).scalar() or 0

        # Presentation downloads count
        downloads = (
            await db.execute(
                select(func.count(AnalyticsEvent.id)).where(
                    AnalyticsEvent.event_name == "PRESENTATION_DOWNLOAD"
                )
            )
        ).scalar() or 0

        # AI opens
        ai_opens = (
            await db.execute(
                select(func.count(AnalyticsEvent.id)).where(
                    AnalyticsEvent.event_name == "AI_OPEN"
                )
            )
        ).scalar() or 0

        # Top product interest in leads
        interests_query = (
            select(Lead.interest, func.count(Lead.id))
            .group_by(Lead.interest)
            .order_by(desc(func.count(Lead.id)))
        )
        interests = (await db.execute(interests_query)).all()

        print("=" * 64)
        print("   CASPEL CIFTIS 2026 — OPERATOR SUMMARY DASHBOARD")
        print("=" * 64)
        print(f"  • Registered Leads          : {lead_count}")
        print(f"  • Total Chat Sessions       : {session_count}")
        print(f"  • Total Questions Asked     : {question_count}")
        print(f"  • AI Assistant Modals Opened: {ai_opens}")
        print(f"  • Presentation Downloads    : {downloads}")
        print(f"  • Total Analytics Events    : {event_count}")
        print(f"  • Ingested Corpus Decks     : {doc_count}")
        print("-" * 64)
        print("  Leads by Product Interest:")
        for interest, count in interests:
            print(f"    - {interest or 'General'}: {count}")
        print("=" * 64)


async def show_leads(as_csv: bool = False, limit: int = 50):
    """List or export registered leads."""
    async with AsyncSessionLocal() as db:
        query = select(Lead).order_by(desc(Lead.created_at)).limit(limit)
        leads = (await db.execute(query)).scalars().all()

        if as_csv:
            writer = csv.writer(sys.stdout)
            writer.writerow([
                "ID", "Name", "Company", "Business Email", "Interest", "Message", "Created At"
            ])
            for l in leads:
                writer.writerow([
                    l.id,
                    l.name,
                    l.company,
                    l.business_email,
                    l.interest,
                    l.message or "",
                    l.created_at.isoformat() if l.created_at else "",
                ])
            return

        headers = ["ID", "Name", "Company", "Email", "Interest", "Date"]
        rows = []
        for l in leads:
            date_str = l.created_at.strftime("%Y-%m-%d %H:%M") if l.created_at else "-"
            rows.append([
                str(l.id),
                l.name[:20],
                l.company[:24],
                l.business_email[:26],
                l.interest[:12],
                date_str,
            ])

        print(f"\nRegistered Leads (latest {len(rows)}):")
        print(format_table(headers, rows))


async def show_chat(limit: int = 20, as_csv: bool = False):
    """List recent visitor questions and AI answers."""
    async with AsyncSessionLocal() as db:
        query = (
            select(ChatMessage)
            .order_by(desc(ChatMessage.created_at), desc(ChatMessage.id))
            .limit(limit * 2)
        )
        messages = list(reversed((await db.execute(query)).scalars().all()))

        if as_csv:
            writer = csv.writer(sys.stdout)
            writer.writerow(["ID", "Session ID", "Role", "Content", "Created At"])
            for m in messages:
                writer.writerow([
                    m.id,
                    m.session_id,
                    m.role,
                    m.content,
                    m.created_at.isoformat() if m.created_at else "",
                ])
            return

        print(f"\nRecent Chat Interactions (last {len(messages)} messages):")
        print("-" * 72)
        for m in messages:
            time_str = m.created_at.strftime("%H:%M:%S") if m.created_at else "--:--:--"
            role_label = "[VISITOR]" if m.role == "user" else "[CASPEL AI]"
            print(f"{time_str} {role_label} (session {m.session_id[:8]}...):")
            # Wrap / indent content
            for line in m.content.strip().split("\n")[:4]:
                print(f"   {line}")
            if len(m.content.strip().split("\n")) > 4:
                print("   ...")
            print("-" * 72)


async def show_analytics(limit: int = 20):
    """List top telemetry events and engagement counts."""
    async with AsyncSessionLocal() as db:
        query = (
            select(AnalyticsEvent.event_name, func.count(AnalyticsEvent.id))
            .group_by(AnalyticsEvent.event_name)
            .order_by(desc(func.count(AnalyticsEvent.id)))
            .limit(limit)
        )
        events = (await db.execute(query)).all()

        headers = ["Event Name", "Count"]
        rows = [[e[0], str(e[1])] for e in events]

        print("\nExhibition Analytics Breakdown:")
        print(format_table(headers, rows))


def main():
    parser = argparse.ArgumentParser(description="CASPEL CIFTIS 2026 Operator CLI")
    subparsers = parser.add_subparsers(dest="command", help="Available subcommands")

    # Summary
    subparsers.add_parser("summary", help="Show overview dashboard")

    # Leads
    leads_parser = subparsers.add_parser("leads", help="View or export leads")
    leads_parser.add_argument("--csv", action="store_true", help="Output as CSV")
    leads_parser.add_argument("--limit", type=int, default=50, help="Max rows to show")

    # Chat
    chat_parser = subparsers.add_parser("chat", help="View recent visitor questions and AI answers")
    chat_parser.add_argument("--limit", type=int, default=15, help="Number of turns to show")
    chat_parser.add_argument("--csv", action="store_true", help="Output as CSV")

    # Analytics
    analytics_parser = subparsers.add_parser("analytics", help="View telemetry breakdown")
    analytics_parser.add_argument("--limit", type=int, default=20, help="Max rows to show")

    args = parser.parse_args()

    cmd = args.command or "summary"
    if cmd == "summary":
        asyncio.run(show_summary())
    elif cmd == "leads":
        asyncio.run(show_leads(as_csv=args.csv, limit=args.limit))
    elif cmd == "chat":
        asyncio.run(show_chat(limit=args.limit, as_csv=args.csv))
    elif cmd == "analytics":
        asyncio.run(show_analytics(limit=args.limit))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
