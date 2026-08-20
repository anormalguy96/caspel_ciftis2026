import os
import sys
import asyncio
import logging
from pathlib import Path

# Add backend root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import AsyncSessionLocal
from app.rag.service import rag_service
from app.core.config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("ingest_documents")

SYNTHETIC_DATASETS = {
    "CASPEL Corporate Presentation": {
        "product": "caspel",
        "slides": [
            (
                "CASPEL LLC - Corporate Overview & Technology Ecosystem\n"
                "Established enterprise technology and systems integration leader in the region.\n"
                "CASPEL delivers end-to-end digital transformation, sovereign infrastructure, and enterprise software solutions.\n"
                "Participating in CIFTIS 2026 (China International Fair for Trade in Services) in Beijing to showcase international software solutions."
            ),
            (
                "CASPEL Core Technology Portfolio:\n"
                "1. Caspel ERP - Enterprise Resource Planning and Operations Automation\n"
                "2. Caspel PMS - Modern Procurement and Vendor Management System\n"
                "3. IRISSEA - High-performance LRIT (Long-Range Identification and Tracking) maritime surveillance solution\n"
                "4. Cloud & Data Center Infrastructure Integration."
            ),
            (
                "CIFTIS 2026 Exhibition Mission in Beijing, China:\n"
                "Strengthening cross-border trade, technology partnerships, and enterprise deployments across Asian and international markets."
            ),
        ]
    },
    "CASPEL ERP Presentation": {
        "product": "erp",
        "slides": [
            (
                "CASPEL ERP - Comprehensive Enterprise Resource Planning System\n"
                "A unified, scalable enterprise platform designed for complex corporate organizations and public enterprises.\n"
                "Seamlessly synchronizes finance, supply chain, manufacturing, assets, and human resources into a single real-time data core."
            ),
            (
                "CASPEL ERP Core Modules:\n"
                "• Financial Accounting & Multi-currency Treasury\n"
                "• Inventory & Supply Chain Logistics Management\n"
                "• Human Capital Management & Payroll Automation\n"
                "• Enterprise Asset Management and Predictive Maintenance\n"
                "• Advanced Business Intelligence, Executive Dashboards, and Compliance Reporting."
            ),
            (
                "Security & Deployment Architecture:\n"
                "Role-based access control (RBAC), end-to-end audit logging, on-premise sovereign cloud or hybrid deployment models."
            ),
        ]
    },
    "CASPEL PMS Presentation": {
        "product": "pms",
        "slides": [
            (
                "CASPEL PMS - Next-Generation Procurement Management System\n"
                "Automating the complete procurement lifecycle from initial requisition to final vendor delivery and supplier settlement."
            ),
            (
                "Key Capabilities of CASPEL PMS:\n"
                "• Electronic Tender & Competitive Bidding Engine\n"
                "• Supplier Qualification, Rating, and Performance Audits\n"
                "• Automated Purchase Order Generation and Approval Hierarchies\n"
                "• Dynamic Contract Lifecycle and Compliance Tracking\n"
                "• Real-time Budgetary Control and Spend Analytics."
            ),
            (
                "Integration & Workflow Benefits:\n"
                "Integrates out-of-the-box with CASPEL ERP and existing third-party banking/financial gateways."
            ),
        ]
    },
    "IRISSEA LRIT Presentation": {
        "product": "irissea",
        "slides": [
            (
                "IRISSEA - Long-Range Identification and Tracking (LRIT) Solution\n"
                "Global maritime domain awareness and vessel tracking system compliant with International Maritime Organization (IMO) standards."
            ),
            (
                "IRISSEA Architecture & Features:\n"
                "• High-precision vessel position monitoring and trajectory prediction\n"
                "• Automated satellite communications transceiver integration\n"
                "• Sovereign coastal state and port state security compliance\n"
                "• Real-time geo-fencing, maritime alert triggers, and SAR (Search and Rescue) coordination support."
            ),
            (
                "Deployment & Certification:\n"
                "Proven in national maritime administration centers with 99.99% operational uptime and military-grade encryption."
            ),
        ]
    }
}


async def main():
    presentations_dir = Path("data/presentations")
    if not presentations_dir.exists():
        presentations_dir = Path("/data/presentations")

    logger.info("Connecting to database for document ingestion...")
    async with AsyncSessionLocal() as session:
        # Check for real PDF files
        pdf_files = list(presentations_dir.glob("*.pdf")) if presentations_dir.exists() else []

        if pdf_files:
            logger.info(f"Found {len(pdf_files)} PDF presentations in {presentations_dir}")
            for pdf_path in pdf_files:
                name = pdf_path.stem
                product = None
                if "erp" in name.lower():
                    product = "erp"
                elif "pms" in name.lower():
                    product = "pms"
                elif "irissea" in name.lower():
                    product = "irissea"
                elif "caspel" in name.lower() or "corp" in name.lower():
                    product = "caspel"

                try:
                    await rag_service.ingest_pdf(
                        db=session,
                        file_path=str(pdf_path),
                        document_name=name,
                        product=product,
                    )
                except Exception as e:
                    logger.error(f"Failed to ingest {pdf_path}: {e}")
        else:
            logger.info("No local PDFs found in data/presentations. Ingesting approved synthetic test dataset...")
            for doc_name, data in SYNTHETIC_DATASETS.items():
                await rag_service.ingest_synthetic_text(
                    db=session,
                    document_name=doc_name,
                    product=data["product"],
                    pages_content=data["slides"],
                )

        logger.info("Ingestion completed successfully!")


if __name__ == "__main__":
    asyncio.run(main())
