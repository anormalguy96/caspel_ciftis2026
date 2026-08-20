import os
from pathlib import Path

def main():
    target_dir = Path("data/presentations")
    target_dir.mkdir(parents=True, exist_ok=True)
    
    gitkeep = target_dir / ".gitkeep"
    gitkeep.touch()

    def create_simple_pdf(filepath: Path, title: str, subtitle: str, points: list):
        body_lines = [
            "BT",
            "/F1 22 Tf",
            "50 700 Td",
            f"({title}) Tj",
            "/F1 15 Tf",
            "0 -35 Td",
            f"({subtitle}) Tj",
            "/F1 11 Tf",
            "0 -35 Td",
            "(CASPEL Technology - CIFTIS 2026 Beijing, China) Tj",
        ]
        for pt in points:
            body_lines.append("0 -25 Td")
            body_lines.append(f"(- {pt}) Tj")
        body_lines.append("ET")

        stream_data = "\n".join(body_lines)
        stream_len = len(stream_data.encode("latin-1"))

        pdf_template = f"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>
endobj
5 0 obj
<< /Length {stream_len} >>
stream
{stream_data}
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000222 00000 n 
0000000303 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
{370 + stream_len}
%%EOF"""
        with open(filepath, "wb") as f:
            f.write(pdf_template.encode("latin-1"))
        print(f"Created {filepath}")

    create_simple_pdf(
        target_dir / "CASPEL_Corporate_Presentation.pdf",
        "CASPEL LLC - Corporate Overview",
        "Digital Transformation & Enterprise Integration",
        ["Enterprise Software Solutions", "System Integration & Sovereign Cloud", "International Market Presence"]
    )

    create_simple_pdf(
        target_dir / "CASPEL_ERP_Presentation.pdf",
        "CASPEL ERP - Enterprise Resource Planning",
        "Comprehensive Business Automation Platform",
        ["Financial Management & Multi-currency Treasury", "Supply Chain & Warehouse Logistics", "Human Resources & Advanced Analytics"]
    )

    create_simple_pdf(
        target_dir / "CASPEL_PMS_Presentation.pdf",
        "CASPEL PMS - Procurement Management",
        "Tender Automation & Vendor Management",
        ["Automated Competitive Bidding Engine", "Supplier Qualification & Performance Audits", "Contract Lifecycle Tracking"]
    )

    create_simple_pdf(
        target_dir / "IRISSEA_LRIT_Presentation.pdf",
        "IRISSEA - LRIT Maritime Solution",
        "Long-Range Identification & Tracking",
        ["IMO Regulation Compliance", "Real-time Vessel Trajectory Tracking", "Coastal State Maritime Security"]
    )

if __name__ == "__main__":
    main()
