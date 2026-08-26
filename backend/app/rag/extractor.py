import logging
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


class DocumentPage:
    def __init__(self, page_number: int, content: str):
        self.page_number = page_number
        self.content = content.strip()


@dataclass
class ExtractionResult:
    """
    What was actually read out of a deck, and what was not.

    Coverage is recorded rather than inferred. "24 pages extracted from a
    24-page deck" and "3 pages extracted, 21 silently dropped" produce the same
    knowledge base size in a log line that only counts chunks; only this tells
    an operator which one happened.
    """

    engine: str
    total_pages: int
    pages: List[DocumentPage] = field(default_factory=list)
    #: Pages whose text came from OCR rather than the PDF text layer.
    ocr_page_numbers: List[int] = field(default_factory=list)
    #: Pages that yielded nothing and were skipped — never substituted.
    empty_page_numbers: List[int] = field(default_factory=list)


def _ocr_page(page) -> str:
    """
    OCR a PyMuPDF page. Returns "" when OCR is unavailable or finds nothing.

    Failures are logged rather than swallowed — a silently dead OCR path is how
    image-only slides end up missing from the knowledge base without anyone
    noticing.
    """
    try:
        import io

        import pytesseract
        from PIL import Image
    except ImportError as e:
        logger.warning(
            "OCR unavailable (%s); image-only slides will be skipped. "
            "Install pytesseract + Pillow and the tesseract binary to index them.", e
        )
        return ""

    try:
        pix = page.get_pixmap(dpi=150)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        return pytesseract.image_to_string(img).strip()
    except Exception as e:
        logger.warning("OCR failed on page %s: %s", page.number + 1, e)
        return ""


class PDFExtractor:
    @staticmethod
    def extract(file_path: str) -> ExtractionResult:
        """
        Extract real text from a PDF, one DocumentPage per page that has content.

        Pages with no extractable text are SKIPPED. They must never be replaced
        with generated prose: everything returned here is embedded and can be
        quoted back to a visitor as a cited source from CASPEL's own materials.
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")

        doc_filename = os.path.basename(file_path)

        # PyMuPDF extraction, with OCR for image-only slides.
        try:
            import pymupdf

            doc = pymupdf.open(file_path)
            result = ExtractionResult(engine="PyMuPDF", total_pages=len(doc))

            for page_idx in range(result.total_pages):
                page = doc[page_idx]
                page_number = page_idx + 1
                text = page.get_text("text").strip()

                if not text:
                    text = _ocr_page(page)
                    if text:
                        result.ocr_page_numbers.append(page_number)

                if text:
                    result.pages.append(DocumentPage(page_number=page_number, content=text))
                else:
                    result.empty_page_numbers.append(page_number)

            doc.close()
            PDFExtractor._log_coverage(doc_filename, result)
            return result

        except Exception as e:
            logger.warning(
                "PyMuPDF extraction failed for %s: %s, falling back to PyPDF", file_path, e
            )

        # PyPDF fallback. No OCR on this path.
        try:
            import pypdf

            reader = pypdf.PdfReader(file_path)
            result = ExtractionResult(engine="PyPDF", total_pages=len(reader.pages))

            for page_idx, page in enumerate(reader.pages):
                page_number = page_idx + 1
                text = (page.extract_text() or "").strip()
                if text:
                    result.pages.append(DocumentPage(page_number=page_number, content=text))
                else:
                    result.empty_page_numbers.append(page_number)

            PDFExtractor._log_coverage(doc_filename, result)
            return result
        except Exception as e:
            logger.error("PDF extraction error on %s: %s", file_path, e)
            raise RuntimeError(f"Failed to extract text from {file_path}: {e}")

    @staticmethod
    def extract_pages(file_path: str) -> List[DocumentPage]:
        """Pages only, for callers that do not need coverage detail."""
        return PDFExtractor.extract(file_path).pages

    @staticmethod
    def _log_coverage(filename: str, result: ExtractionResult) -> None:
        detail = f"{len(result.pages)}/{result.total_pages} pages extracted"
        if result.ocr_page_numbers:
            detail += f" ({len(result.ocr_page_numbers)} via OCR: {result.ocr_page_numbers})"
        logger.info("%s extraction completed for %s: %s.", result.engine, filename, detail)

        if result.empty_page_numbers:
            logger.warning(
                "%s: %s page(s) had no extractable text and were skipped rather than "
                "substituted: %s",
                filename, len(result.empty_page_numbers), result.empty_page_numbers,
            )

    @staticmethod
    def chunk_page(page: DocumentPage, max_chunk_chars: int = 1500) -> List[Dict[str, Any]]:
        """
        Chunk a presentation page. One slide is typically one chunk; a slide with
        excessive text is split on paragraph boundaries.
        """
        text = page.content
        if len(text) <= max_chunk_chars:
            return [{"page_number": page.page_number, "chunk_index": 0, "content": text}]

        chunks: List[Dict[str, Any]] = []
        current_chunk: List[str] = []
        current_len = 0
        chunk_idx = 0

        for paragraph in text.split("\n\n"):
            p_str = paragraph.strip()
            if not p_str:
                continue
            if current_len + len(p_str) > max_chunk_chars and current_chunk:
                chunks.append({
                    "page_number": page.page_number,
                    "chunk_index": chunk_idx,
                    "content": "\n\n".join(current_chunk),
                })
                chunk_idx += 1
                current_chunk = []
                current_len = 0

            current_chunk.append(p_str)
            current_len += len(p_str)

        if current_chunk:
            chunks.append({
                "page_number": page.page_number,
                "chunk_index": chunk_idx,
                "content": "\n\n".join(current_chunk),
            })

        return chunks
