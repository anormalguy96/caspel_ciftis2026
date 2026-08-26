"""
Presentation delivery.

Availability is not "a big file whose first bytes are %PDF-". A deck is served
only when the file on disk is byte-for-byte the approved one: exact size, exact
SHA256, a successful parse, and the exact approved page count. These tests pin
each of those down, plus the failure modes that a looser rule would let through
(recompressed copy, truncated file, corrupt tail, wrong document at the right
filename) and the path-traversal attempts the routes must refuse.
"""
import hashlib
from dataclasses import replace

import pytest
from httpx import AsyncClient

from app.core import presentations as pres
from app.core.config import settings
from app.core.presentations import PRESENTATIONS, PresentationSpec

CASPEL = "caspel"


def make_pdf(path, pages: int) -> bytes:
    """Author a real, parseable multi-page PDF at `path`."""
    import pymupdf

    doc = pymupdf.open()
    for i in range(pages):
        page = doc.new_page()
        page.insert_text((72, 96), f"CASPEL test slide {i + 1}")
    doc.save(str(path))
    doc.close()
    return path.read_bytes()


@pytest.fixture
def approved(tmp_path, monkeypatch):
    """
    A presentations directory holding one genuine, approved deck.

    The registry is rewritten so `caspel` expects exactly the file that was
    written here; `pms` keeps its real "no approved file yet" state.
    """
    target = tmp_path / "presentations"
    target.mkdir()
    monkeypatch.setattr(settings, "DATA_PRESENTATIONS_DIR", str(target))
    assert settings.presentations_dir == target.resolve()

    spec = PRESENTATIONS[CASPEL]
    path = target / spec.filename
    body = make_pdf(path, pages=6)

    monkeypatch.setitem(
        PRESENTATIONS,
        CASPEL,
        replace(
            spec,
            sha256=hashlib.sha256(body).hexdigest(),
            page_count=6,
            size_bytes=len(body),
        ),
    )
    monkeypatch.setattr(
        pres, "REGISTERED_SLUGS", tuple(s for s, v in PRESENTATIONS.items() if v.is_registered)
    )
    pres.clear_cache()
    return target


@pytest.fixture
def empty_dir(tmp_path, monkeypatch):
    target = tmp_path / "presentations"
    target.mkdir()
    monkeypatch.setattr(settings, "DATA_PRESENTATIONS_DIR", str(target))
    pres.clear_cache()
    return target


async def manifest(client: AsyncClient):
    response = await client.get("/api/presentations")
    assert response.status_code == 200, response.text
    return response.json()


# --------------------------------------------------------------------------
# The registry itself
# --------------------------------------------------------------------------

def test_registry_pins_the_protected_digests():
    """The two approved decks are pinned by exact hash, size and page count."""
    corporate = PRESENTATIONS["caspel"]
    erp = PRESENTATIONS["erp"]

    assert corporate.sha256 == "051796d6e7e6f9243739b2985a0d8d04525e55d8ef6067ba78aa3aa9e1811f03"
    assert corporate.size_bytes == 24433969
    assert corporate.page_count == 24

    assert erp.sha256 == "e7033d04ff59141572ffd4cdd57163c031d7faa39052c51e29424dd0cf50aab7"
    assert erp.size_bytes == 5480032
    assert erp.page_count == 41


def test_unsupplied_products_have_no_approved_file():
    """PMS and IRISSEA must not be publishable until CASPEL supplies them."""
    for slug in ("pms", "irissea"):
        assert PRESENTATIONS[slug].is_registered is False


# --------------------------------------------------------------------------
# Manifest
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_manifest_returns_every_allowlisted_slug(client: AsyncClient, empty_dir):
    assert set(await manifest(client)) == set(PRESENTATIONS)


@pytest.mark.asyncio
async def test_manifest_publishes_the_approved_file(client: AsyncClient, approved):
    body = await manifest(client)

    assert body[CASPEL]["available"] is True
    assert body[CASPEL]["page_count"] == 6
    assert body[CASPEL]["size_bytes"] == PRESENTATIONS[CASPEL].size_bytes
    assert body[CASPEL]["download_filename"] == PRESENTATIONS[CASPEL].filename


@pytest.mark.asyncio
async def test_manifest_withholds_a_missing_file(client: AsyncClient, empty_dir):
    body = await manifest(client)
    assert body[CASPEL]["available"] is False
    assert body[CASPEL]["size_bytes"] is None
    assert body[CASPEL]["page_count"] is None


@pytest.mark.asyncio
async def test_manifest_withholds_a_slug_with_no_approved_file(client: AsyncClient, approved):
    """A file dropped in under the PMS name must NOT publish itself."""
    make_pdf(approved / PRESENTATIONS["pms"].filename, pages=6)
    pres.clear_cache()

    assert (await manifest(client))["pms"]["available"] is False


@pytest.mark.asyncio
async def test_manifest_rejects_a_recompressed_copy(client: AsyncClient, approved):
    """
    The exact failure this project shipped: a valid, parseable PDF of the right
    page count that is no longer the approved file.
    """
    path = approved / PRESENTATIONS[CASPEL].filename
    original = path.read_bytes()
    make_pdf(path, pages=6)  # same page count, different bytes
    assert path.read_bytes() != original
    pres.clear_cache()

    assert (await manifest(client))[CASPEL]["available"] is False
    assert pres.verify(CASPEL).reason in ("sha256_mismatch", "size_mismatch")


@pytest.mark.asyncio
async def test_manifest_rejects_a_truncated_file(client: AsyncClient, approved):
    path = approved / PRESENTATIONS[CASPEL].filename
    path.write_bytes(path.read_bytes()[: PRESENTATIONS[CASPEL].size_bytes // 2])
    pres.clear_cache()

    assert (await manifest(client))[CASPEL]["available"] is False
    assert pres.verify(CASPEL).reason == "size_mismatch"


@pytest.mark.asyncio
async def test_manifest_rejects_a_corrupt_file_of_the_right_size(client: AsyncClient, approved):
    """Right length, right signature, unparseable body."""
    spec = PRESENTATIONS[CASPEL]
    path = approved / spec.filename
    path.write_bytes(b"%PDF-1.7\n" + b"\x00" * (spec.size_bytes - 9))
    pres.clear_cache()

    assert (await manifest(client))[CASPEL]["available"] is False
    assert pres.verify(CASPEL).reason == "sha256_mismatch"


@pytest.mark.asyncio
async def test_manifest_rejects_an_empty_file(client: AsyncClient, approved):
    (approved / PRESENTATIONS[CASPEL].filename).write_bytes(b"")
    pres.clear_cache()

    assert (await manifest(client))[CASPEL]["available"] is False
    assert pres.verify(CASPEL).reason == "empty_file"


@pytest.mark.asyncio
async def test_manifest_rejects_the_wrong_page_count(client: AsyncClient, approved, monkeypatch):
    """A file that hashes correctly but does not have the approved page count."""
    spec = PRESENTATIONS[CASPEL]
    monkeypatch.setitem(PRESENTATIONS, CASPEL, replace(spec, page_count=99))
    pres.clear_cache()

    assert (await manifest(client))[CASPEL]["available"] is False
    assert pres.verify(CASPEL).reason == "page_count_mismatch"


@pytest.mark.asyncio
async def test_manifest_reflects_a_corrected_file_without_restart(client: AsyncClient, approved):
    """Replacing a bad file with the approved one republishes it, no restart."""
    spec = PRESENTATIONS[CASPEL]
    path = approved / spec.filename
    good = path.read_bytes()

    path.write_bytes(b"%PDF-1.7\n" + b"x" * 5000)
    pres.clear_cache()
    assert (await manifest(client))[CASPEL]["available"] is False

    path.write_bytes(good)
    pres.clear_cache()
    assert (await manifest(client))[CASPEL]["available"] is True


# --------------------------------------------------------------------------
# Download
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_download_serves_the_approved_pdf_as_an_attachment(client: AsyncClient, approved):
    response = await client.get(f"/api/presentations/{CASPEL}/download")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert PRESENTATIONS[CASPEL].filename in response.headers["content-disposition"]
    assert response.content.startswith(b"%PDF-")
    assert hashlib.sha256(response.content).hexdigest() == PRESENTATIONS[CASPEL].sha256


@pytest.mark.asyncio
async def test_download_unknown_slug_is_404(client: AsyncClient, approved):
    assert (await client.get("/api/presentations/nope/download")).status_code == 404


@pytest.mark.asyncio
async def test_download_missing_file_is_404(client: AsyncClient, empty_dir):
    assert (await client.get(f"/api/presentations/{CASPEL}/download")).status_code == 404


@pytest.mark.asyncio
async def test_download_refuses_a_file_that_fails_verification(client: AsyncClient, approved):
    path = approved / PRESENTATIONS[CASPEL].filename
    make_pdf(path, pages=6)
    pres.clear_cache()

    assert (await client.get(f"/api/presentations/{CASPEL}/download")).status_code == 404


@pytest.mark.asyncio
async def test_slug_is_case_and_whitespace_insensitive(client: AsyncClient, approved):
    assert (await client.get("/api/presentations/CASPEL/download")).status_code == 200


@pytest.mark.asyncio
async def test_traversal_slug_is_rejected(client: AsyncClient, approved):
    secret = approved.parent / "secret.env"
    secret.write_bytes(b"POSTGRES_PASSWORD=hunter2")

    for slug in ("../secret.env", "..%2Fsecret.env", "....//secret.env", "%2e%2e%2fsecret.env"):
        for route in ("download", "stream"):
            response = await client.get(f"/api/presentations/{slug}/{route}")
            assert response.status_code in (404, 403), f"{slug}/{route} -> {response.status_code}"
            assert b"hunter2" not in response.content


def test_resolve_path_refuses_an_escaping_filename(approved, monkeypatch):
    """Containment is enforced even if a registry entry were mis-edited."""
    monkeypatch.setitem(
        PRESENTATIONS,
        CASPEL,
        replace(PRESENTATIONS[CASPEL], filename="../escaped.pdf"),
    )
    assert pres.resolve_path(CASPEL) is None


# --------------------------------------------------------------------------
# Stream / Range
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_stream_without_range_returns_whole_file(client: AsyncClient, approved):
    total = PRESENTATIONS[CASPEL].size_bytes

    response = await client.get(f"/api/presentations/{CASPEL}/stream")

    assert response.status_code == 200, response.text
    assert response.headers["accept-ranges"] == "bytes"
    assert len(response.content) == total


@pytest.mark.asyncio
async def test_stream_honours_byte_range(client: AsyncClient, approved):
    total = PRESENTATIONS[CASPEL].size_bytes

    response = await client.get(
        f"/api/presentations/{CASPEL}/stream", headers={"Range": "bytes=0-1023"}
    )

    assert response.status_code == 206, response.text
    assert response.headers["content-range"] == f"bytes 0-1023/{total}"
    assert response.headers["content-type"] == "application/pdf"
    assert len(response.content) == 1024
    assert response.content.startswith(b"%PDF-")


@pytest.mark.asyncio
async def test_stream_open_ended_range(client: AsyncClient, approved):
    total = PRESENTATIONS[CASPEL].size_bytes
    start = total - 500

    response = await client.get(
        f"/api/presentations/{CASPEL}/stream", headers={"Range": f"bytes={start}-"}
    )

    assert response.status_code == 206
    assert response.headers["content-range"] == f"bytes {start}-{total - 1}/{total}"
    assert len(response.content) == 500


@pytest.mark.asyncio
async def test_stream_suffix_range_returns_final_bytes(client: AsyncClient, approved):
    """`bytes=-N` means the last N bytes, not the first N."""
    path = approved / PRESENTATIONS[CASPEL].filename
    total = PRESENTATIONS[CASPEL].size_bytes

    response = await client.get(
        f"/api/presentations/{CASPEL}/stream", headers={"Range": "bytes=-500"}
    )

    assert response.status_code == 206
    assert response.headers["content-range"] == f"bytes {total - 500}-{total - 1}/{total}"
    assert response.content == path.read_bytes()[-500:]


@pytest.mark.asyncio
async def test_stream_unsatisfiable_range_returns_416(client: AsyncClient, approved):
    total = PRESENTATIONS[CASPEL].size_bytes

    response = await client.get(
        f"/api/presentations/{CASPEL}/stream",
        headers={"Range": f"bytes={total + 10}-{total + 99}"},
    )

    assert response.status_code == 416
    assert response.headers["content-range"] == f"bytes */{total}"


@pytest.mark.asyncio
async def test_stream_rejects_malformed_range(client: AsyncClient, approved):
    """An unrecognised range unit is refused rather than silently served in full."""
    response = await client.get(
        f"/api/presentations/{CASPEL}/stream", headers={"Range": "pages=1-2"}
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_stream_missing_file_is_404(client: AsyncClient, empty_dir):
    assert (await client.get(f"/api/presentations/{CASPEL}/stream")).status_code == 404


@pytest.mark.asyncio
async def test_no_filename_addressed_presentation_route(client: AsyncClient, approved):
    """
    The old /presentations/{filename} route bypassed verification entirely and
    served whatever sat in the directory. It must stay gone.
    """
    response = await client.get(f"/presentations/{PRESENTATIONS[CASPEL].filename}")
    assert response.status_code == 404
