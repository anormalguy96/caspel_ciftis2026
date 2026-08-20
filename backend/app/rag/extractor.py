import os
from typing import List, Dict, Any
import logging

logger = logging.getLogger(__name__)


class DocumentPage:
    def __init__(self, page_number: int, content: str):
        self.page_number = page_number
        self.content = content.strip()


class PDFExtractor:
    @staticmethod
    def extract_pages(file_path: str) -> List[DocumentPage]:
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")

        pages: List[DocumentPage] = []

        # Try PyMuPDF (fitz) first
        try:
            import fitz
            doc = fitz.open(file_path)
            for page_idx in range(len(doc)):
                page = doc[page_idx]
                text = page.get_text("text").strip()
                if text:
                    pages.append(DocumentPage(page_number=page_idx + 1, content=text))
            doc.close()
            if pages:
                return pages
        except ImportError:
            logger.info("PyMuPDF (fitz) not available, falling back to pypdf")
        except Exception as e:
            logger.warning(f"PyMuPDF extraction failed: {e}, attempting pypdf fallback")

        # PyPDF fallback
        try:
            import pypdf
            reader = pypdf.PdfReader(file_path)
            for page_idx, page in enumerate(reader.pages):
                text = page.extract_text()
                if text and text.strip():
                    pages.append(DocumentPage(page_number=page_idx + 1, content=text.strip()))
            return pages
        except Exception as e:
            logger.error(f"PDF extraction error on {file_path}: {e}")
            raise RuntimeError(f"Failed to extract text from {file_path}: {e}")

    @staticmethod
    def chunk_page(page: DocumentPage, max_chunk_chars: int = 1500) -> List[Dict[str, Any]]:
        """
        Chunk presentation page. One slide is typically 1 chunk.
        If a slide has excessive text (> max_chunk_chars), split by paragraphs.
        """
        text = page.content
        if len(text) <= max_chunk_chars:
            return [{"page_number": page.page_number, "chunk_index": 0, "content": text}]

        # Split long page into smaller chunks
        chunks = []
        paragraphs = text.split("\n\n")
        current_chunk = []
        current_len = 0
        chunk_idx = 0

        for p in paragraphs:
            p_str = p.strip()
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
