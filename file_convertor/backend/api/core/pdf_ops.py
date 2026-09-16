"""PDF organize/security operations: merge, split, compress, rotate, protect, unlock.

Conversion libraries are imported lazily inside each function: the hosted
platform imports this module at route-load time in an environment where a
heavy native wheel may be unavailable, and a module-level import failure
would take down EVERY route (it surfaced as "route gate failed: No module
named 'pikepdf'" in review). A missing library must only fail the one
request that needs it — routes/tools.py maps ImportError to HTTP 424.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException

from .files import output_dir


def _open_doc(path: Path):
    """Open a PDF with PyMuPDF, surfacing parse/encryption errors as 422.

    These organize/security operations are built on PyMuPDF (``fitz``) rather
    than pypdf: pypdf is not installed on the hosted platform, so importing it
    made Merge/Split/Rotate/Protect/Unlock all 424 with "missing dependency:
    No module named 'pypdf'". PyMuPDF is already used by compress/watermark/
    crop and is available on the host.
    """
    import fitz

    try:
        doc = fitz.open(str(path))
    except Exception as exc:  # noqa: BLE001 — surface any parse failure as 422
        raise HTTPException(status_code=422, detail=f"'{path.name}' is not a valid PDF ({exc}).")
    if doc.needs_pass:
        doc.close()
        raise HTTPException(
            status_code=422,
            detail=f"'{path.name}' is password-protected. Use the Unlock PDF tool first.",
        )
    return doc


def merge_pdfs(inputs: list[Path], workdir: Path) -> list[Path]:
    import fitz

    if len(inputs) < 2:
        raise HTTPException(status_code=422, detail="Merging needs at least two PDF files.")
    merged = fitz.open()
    try:
        for path in inputs:
            src = _open_doc(path)
            try:
                merged.insert_pdf(src)
            finally:
                src.close()
        out = output_dir(workdir) / "merged.pdf"
        merged.save(str(out))
    finally:
        merged.close()
    return [out]


def parse_ranges(spec: str, page_count: int) -> list[tuple[int, int]]:
    """Parse '1-3,5,7-9' into inclusive 1-based (start, end) tuples."""
    ranges: list[tuple[int, int]] = []
    for chunk in spec.replace(" ", "").split(","):
        if not chunk:
            continue
        if "-" in chunk:
            start_s, _, end_s = chunk.partition("-")
        else:
            start_s = end_s = chunk
        try:
            start, end = int(start_s), int(end_s)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid page range '{chunk}'. Use e.g. 1-3,5,7-9.")
        if not (1 <= start <= end <= page_count):
            raise HTTPException(
                status_code=422,
                detail=f"Range '{chunk}' is out of bounds — the document has {page_count} pages.",
            )
        ranges.append((start, end))
    if not ranges:
        raise HTTPException(status_code=422, detail="No page ranges given. Use e.g. 1-3,5,7-9.")
    return ranges


def split_pdf(src: Path, workdir: Path, ranges_spec: str | None) -> list[Path]:
    import fitz

    doc = _open_doc(src)
    try:
        total = doc.page_count
        out = output_dir(workdir)
        outputs: list[Path] = []

        if ranges_spec and ranges_spec.strip():
            ranges = parse_ranges(ranges_spec, total)
        else:
            ranges = [(i, i) for i in range(1, total + 1)]  # default: one file per page

        for start, end in ranges:
            part = fitz.open()
            try:
                part.insert_pdf(doc, from_page=start - 1, to_page=end - 1)
                label = f"pages_{start}-{end}" if start != end else f"page_{start}"
                path = out / f"{src.stem}_{label}.pdf"
                part.save(str(path))
            finally:
                part.close()
            outputs.append(path)
    finally:
        doc.close()
    return outputs


_COMPRESS_DPI = {"low": 150, "medium": 110, "high": 72}
_COMPRESS_QUALITY = {"low": 80, "medium": 65, "high": 45}


def compress_pdf(src: Path, workdir: Path, level: str = "medium") -> list[Path]:
    if level not in _COMPRESS_DPI:
        raise HTTPException(status_code=422, detail="Compression level must be low, medium or high.")

    import fitz  # PyMuPDF

    out = output_dir(workdir) / f"{src.stem}_compressed.pdf"
    try:
        doc = fitz.open(str(src))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"'{src.name}' is not a valid PDF ({exc}).")
    if doc.needs_pass:
        raise HTTPException(status_code=422, detail="PDF is password-protected. Unlock it first.")

    # Downsample embedded images, then rewrite the file with maximum garbage
    # collection and stream deflation.
    dpi, quality = _COMPRESS_DPI[level], _COMPRESS_QUALITY[level]
    try:
        doc.rewrite_images(dpi_threshold=dpi + 1, dpi_target=dpi, quality=quality, lossy=True, lossless=True)
    except Exception:  # noqa: BLE001 — older PyMuPDF or odd images: fall through to plain rewrite
        pass
    doc.save(str(out), garbage=4, deflate=True, clean=True, use_objstms=True)
    doc.close()

    # Never hand back a "compressed" file bigger than the original.
    if out.stat().st_size >= src.stat().st_size:
        out.write_bytes(src.read_bytes())
    return [out]


def rotate_pdf(src: Path, workdir: Path, angle: int) -> list[Path]:
    if angle % 90 != 0:
        raise HTTPException(status_code=422, detail="Rotation angle must be a multiple of 90.")
    doc = _open_doc(src)
    try:
        for page in doc:
            # Add to the page's existing rotation (pypdf's page.rotate() was additive).
            page.set_rotation((page.rotation + angle) % 360)
        out = output_dir(workdir) / f"{src.stem}_rotated.pdf"
        doc.save(str(out))
    finally:
        doc.close()
    return [out]


def protect_pdf(src: Path, workdir: Path, password: str) -> list[Path]:
    import fitz

    if not password:
        raise HTTPException(status_code=422, detail="A password is required to protect the PDF.")
    doc = _open_doc(src)
    try:
        # Allow every standard PDF permission for a reader who supplies the
        # password, matching pypdf's default encrypt() (owner == user password).
        perms = int(
            fitz.PDF_PERM_ACCESSIBILITY
            | fitz.PDF_PERM_PRINT
            | fitz.PDF_PERM_PRINT_HQ
            | fitz.PDF_PERM_COPY
            | fitz.PDF_PERM_ANNOTATE
            | fitz.PDF_PERM_FORM
            | fitz.PDF_PERM_MODIFY
            | fitz.PDF_PERM_ASSEMBLE
        )
        out = output_dir(workdir) / f"{src.stem}_protected.pdf"
        doc.save(
            str(out),
            encryption=fitz.PDF_ENCRYPT_AES_256,
            owner_pw=password,
            user_pw=password,
            permissions=perms,
        )
    finally:
        doc.close()
    return [out]


_POSITIONS = {
    "top-left", "top-center", "top-right",
    "center",
    "bottom-left", "bottom-center", "bottom-right",
}


def _anchor_point(rect, position: str, margin: float = 24) -> tuple[float, float, str]:
    """Return (x, y, anchor) for a position keyword on a page of size `rect`."""
    x_left, x_center, x_right = rect.x0 + margin, rect.x0 + rect.width / 2, rect.x1 - margin
    y_top, y_center, y_bottom = rect.y0 + margin, rect.y0 + rect.height / 2, rect.y1 - margin
    xs = {"left": x_left, "center": x_center, "right": x_right}
    ys = {"top": y_top, "center": y_center, "bottom": y_bottom}
    if position == "center":
        return x_center, y_center, "center"
    v, h = position.split("-")
    return xs[h], ys[v], h


def watermark_pdf(
    src: Path, workdir: Path, *, text: str, position: str = "center",
    opacity: int = 35, color: str = "#FF0000",
    x: str | None = None, y: str | None = None,
    width: str | None = None, rotate: str | None = None,
) -> list[Path]:
    """Stamp `text` over every page of a PDF.

    `x`/`y` are the watermark's center as a fraction (0-1) of the page's
    width/height (from the drag-to-place picker); `width` is the target text
    width in points (the font size is derived from it); `rotate` is a rotation
    in degrees applied around the center. When `x`/`y` are absent the legacy
    `position` keyword (a corner/center anchor) is used instead."""
    import fitz

    text = (text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="Watermark text is required.")
    opacity = max(5, min(opacity, 100))
    try:
        rgb = tuple(int(color.lstrip("#")[i : i + 2], 16) / 255 for i in (0, 2, 4))
    except (ValueError, IndexError):
        raise HTTPException(status_code=422, detail=f"Invalid color '{color}'. Use a hex code like #FF0000.")

    # Fractional placement (picker) takes precedence over the position keyword.
    x_frac = y_frac = None
    if x not in (None, "") and y not in (None, ""):
        try:
            x_frac, y_frac = float(x), float(y)
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid watermark position.")
        if not (0.0 <= x_frac <= 1.0 and 0.0 <= y_frac <= 1.0):
            raise HTTPException(status_code=422, detail="Watermark position must be within the page.")
    elif position not in _POSITIONS:
        raise HTTPException(status_code=422, detail=f"Invalid position '{position}'.")

    try:
        width_pt = float(width) if width not in (None, "") else None
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid watermark width.")
    try:
        angle = float(rotate) if rotate not in (None, "") else 0.0
    except ValueError:
        angle = 0.0

    try:
        doc = fitz.open(str(src))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"'{src.name}' is not a valid PDF ({exc}).")
    if doc.needs_pass:
        doc.close()
        raise HTTPException(status_code=422, detail="PDF is password-protected. Unlock it first.")

    diagonal = x_frac is None and position == "center"
    for page in doc:
        shape = page.new_shape()
        kwargs = {"color": rgb, "fill_opacity": opacity / 100}
        if x_frac is not None:
            # Center the text at the picked fraction; derive the font size from
            # the requested text width (get_text_length is linear in fontsize).
            rect = page.rect
            cx = rect.x0 + x_frac * rect.width
            cy = rect.y0 + y_frac * rect.height
            target_w = width_pt if width_pt else min(rect.width, rect.height) * 0.5
            target_w = max(10.0, min(target_w, rect.width * 3))
            ref_len = fitz.get_text_length(text, fontsize=100) or 1.0
            fontsize = max(6.0, min(100.0 * target_w / ref_len, 800.0))
            text_len = fitz.get_text_length(text, fontsize=fontsize)
            point = fitz.Point(cx - text_len / 2, cy + fontsize * 0.35)
            kwargs["fontsize"] = fontsize
            if angle:
                kwargs["morph"] = (fitz.Point(cx, cy), fitz.Matrix(1, 1).prerotate(angle))
        else:
            fontsize = max(18, min(page.rect.width, page.rect.height) / 10)
            if width_pt:
                ref_len = fitz.get_text_length(text, fontsize=100) or 1.0
                fontsize = max(6.0, min(100.0 * width_pt / ref_len, 800.0))
            ax, ay, anchor = _anchor_point(page.rect, position)
            text_len = fitz.get_text_length(text, fontsize=fontsize)
            dx = {"left": 0, "center": -text_len / 2, "right": -text_len}[anchor]
            point = fitz.Point(ax + dx, ay)
            kwargs["fontsize"] = fontsize
            if diagonal:
                # insert_text's `rotate` kwarg only accepts multiples of 90; an
                # arbitrary 45° diagonal needs a rotation matrix via `morph`.
                kwargs["morph"] = (point, fitz.Matrix(1, 1).prerotate(45))
        shape.insert_text(point, text, **kwargs)
        shape.commit(overlay=True)
    out = output_dir(workdir) / f"{src.stem}_watermarked.pdf"
    doc.save(str(out))
    doc.close()
    return [out]


def add_page_numbers(
    src: Path, workdir: Path, *, position: str = "bottom-center", start: int = 1, fmt: str = "{n}",
) -> list[Path]:
    import fitz

    if position not in _POSITIONS:
        raise HTTPException(status_code=422, detail=f"Invalid position '{position}'.")
    if "{n}" not in fmt and "{total}" not in fmt:
        raise HTTPException(status_code=422, detail="Format must include {n} (and optionally {total}).")

    try:
        doc = fitz.open(str(src))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"'{src.name}' is not a valid PDF ({exc}).")
    if doc.needs_pass:
        doc.close()
        raise HTTPException(status_code=422, detail="PDF is password-protected. Unlock it first.")

    total = doc.page_count
    for i, page in enumerate(doc):
        label = fmt.format(n=start + i, total=total)
        x, y, anchor = _anchor_point(page.rect, position, margin=20)
        fontsize = 10
        text_len = fitz.get_text_length(label, fontsize=fontsize)
        dx = {"left": 0, "center": -text_len / 2, "right": -text_len}[anchor]
        page.insert_text(fitz.Point(x + dx, y), label, fontsize=fontsize, color=(0, 0, 0))
    out = output_dir(workdir) / f"{src.stem}_numbered.pdf"
    doc.save(str(out))
    doc.close()
    return [out]


def crop_pdf(src: Path, workdir: Path, margins: str = "", rect: str | None = None) -> list[Path]:
    """Crop every page to a keep-region.

    `rect` (preferred, from the drag-a-rectangle picker) is "x,y,w,h" as
    fractions (0-1) of each page — the top-left corner and size of the area to
    keep, applied per page so it works across mixed page sizes. `margins` is the
    legacy CSS-style "top,right,bottom,left" string in points (still used when
    `rect` is absent, e.g. by older workflow steps)."""
    import fitz

    rect_fracs = None
    if rect not in (None, ""):
        parts = [p.strip() for p in rect.split(",")]
        if len(parts) != 4:
            raise HTTPException(status_code=422, detail="Crop rect must be 'x,y,w,h' as fractions.")
        try:
            rx, ry, rw, rh = (float(p) for p in parts)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid crop rect '{rect}'.")
        if rw <= 0 or rh <= 0 or rx < 0 or ry < 0 or rx + rw > 1.0001 or ry + rh > 1.0001:
            raise HTTPException(status_code=422, detail="Crop rect must lie within the page.")
        rect_fracs = (rx, ry, rw, rh)
    else:
        parts = [p.strip() for p in margins.split(",")] if margins else []
        if len(parts) != 4:
            raise HTTPException(
                status_code=422,
                detail="Margins must be 'top,right,bottom,left' in points, e.g. 36,36,36,36.",
            )
        try:
            top, right, bottom, left = (float(p) for p in parts)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid margins '{margins}'.")
        if min(top, right, bottom, left) < 0:
            raise HTTPException(status_code=422, detail="Margins cannot be negative.")

    try:
        doc = fitz.open(str(src))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"'{src.name}' is not a valid PDF ({exc}).")
    if doc.needs_pass:
        doc.close()
        raise HTTPException(status_code=422, detail="PDF is password-protected. Unlock it first.")

    for page in doc:
        r = page.rect
        if rect_fracs is not None:
            rx, ry, rw, rh = rect_fracs
            new_rect = fitz.Rect(
                r.x0 + rx * r.width, r.y0 + ry * r.height,
                r.x0 + (rx + rw) * r.width, r.y0 + (ry + rh) * r.height,
            )
        else:
            new_rect = fitz.Rect(r.x0 + left, r.y0 + top, r.x1 - right, r.y1 - bottom)
        new_rect = new_rect & r  # clamp to the page
        if new_rect.width <= 1 or new_rect.height <= 1:
            doc.close()
            raise HTTPException(status_code=422, detail="The crop area is too small for this page size.")
        page.set_cropbox(new_rect)
    out = output_dir(workdir) / f"{src.stem}_cropped.pdf"
    doc.save(str(out))
    doc.close()
    return [out]


def repair_pdf(src: Path, workdir: Path) -> list[Path]:
    """Reopen and rewrite a damaged PDF. PyMuPDF's parser recovers from many
    structural errors (broken xref tables, dangling objects); resaving with
    garbage collection drops anything it truly can't fix."""
    import fitz

    try:
        doc = fitz.open(str(src))
        page_count = doc.page_count  # forces a parse of the page tree
        if page_count == 0:
            raise ValueError("no pages could be recovered")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Could not repair '{src.name}': {exc}")

    out = output_dir(workdir) / f"{src.stem}_repaired.pdf"
    doc.save(str(out), garbage=4, deflate=True, clean=True)
    doc.close()
    return [out]


def redact_pdf(src: Path, workdir: Path, term: str) -> list[Path]:
    """Permanently remove every exact occurrence of `term` (case-insensitive)."""
    import fitz

    term = (term or "").strip()
    if not term:
        raise HTTPException(status_code=422, detail="Enter the text you want to redact.")

    try:
        doc = fitz.open(str(src))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"'{src.name}' is not a valid PDF ({exc}).")
    if doc.needs_pass:
        doc.close()
        raise HTTPException(status_code=422, detail="PDF is password-protected. Unlock it first.")

    hits = 0
    for page in doc:
        matches = page.search_for(term, quads=False)
        for rect in matches:
            page.add_redact_annot(rect, fill=(0, 0, 0))
        hits += len(matches)
        if matches:
            page.apply_redactions()

    if hits == 0:
        doc.close()
        raise HTTPException(status_code=422, detail=f"'{term}' was not found in this PDF.")

    out = output_dir(workdir) / f"{src.stem}_redacted.pdf"
    doc.save(str(out), garbage=4, deflate=True)
    doc.close()
    return [out]


def pdf_to_pdfa(src: Path, workdir: Path) -> list[Path]:
    """Best-effort PDF/A-2B tagging: embeds an sRGB OutputIntent and PDF/A XMP
    metadata. This does not verify or enforce full ISO 19005-2 compliance
    (e.g. it does not check that every font is embedded) — it's a practical
    archival pass, not a certified converter.

    Built on PyMuPDF (``fitz``) rather than pikepdf: pikepdf is not installed on
    the hosted platform, so this tool 424'd with "No module named 'pikepdf'".
    fitz's low-level PDF API (get_new_xref / update_object / update_stream /
    xref_set_key) creates the OutputIntent and its ICC stream, and
    set_xml_metadata writes the PDF/A XMP packet.
    """
    import html

    import fitz

    try:
        doc = fitz.open(str(src))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"'{src.name}' is not a valid PDF ({exc}).")
    if doc.needs_pass:
        doc.close()
        raise HTTPException(status_code=422, detail="PDF is password-protected. Unlock it first.")

    try:
        # PDF/A identification + Dublin Core metadata as an XMP packet.
        title = html.escape(src.stem)
        xmp = (
            '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
            '<x:xmpmeta xmlns:x="adobe:ns:meta/">'
            '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
            '<rdf:Description rdf:about="" '
            'xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/">'
            "<pdfaid:part>2</pdfaid:part>"
            "<pdfaid:conformance>B</pdfaid:conformance>"
            "<dc:format>application/pdf</dc:format>"
            f'<dc:title><rdf:Alt><rdf:li xml:lang="x-default">{title}</rdf:li></rdf:Alt></dc:title>'
            "</rdf:Description></rdf:RDF></x:xmpmeta>"
            '<?xpacket end="w"?>'
        )
        doc.set_xml_metadata(xmp)

        srgb_icc = (
            b"\x00\x00\x02\x0cappl\x02 \x00\x00mntrRGB XYZ \x07\xd0\x00\x08\x00\x0b\x00\x13\x00\x003"
            b"acspAPPL\x00\x00\x00\x00appl\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
        )
        icc_xref = doc.get_new_xref()
        doc.update_object(icc_xref, "<< /N 3 >>")
        doc.update_stream(icc_xref, srgb_icc, new=True)

        intent_xref = doc.get_new_xref()
        doc.update_object(
            intent_xref,
            "<< /Type /OutputIntent /S /GTS_PDFA1 "
            "/OutputConditionIdentifier (sRGB IEC61966-2.1) /Info (sRGB IEC61966-2.1) "
            f"/DestOutputProfile {icc_xref} 0 R >>",
        )
        doc.xref_set_key(doc.pdf_catalog(), "OutputIntents", f"[ {intent_xref} 0 R ]")

        out = output_dir(workdir) / f"{src.stem}_pdfa.pdf"
        doc.save(str(out), deflate=True)
    finally:
        doc.close()
    return [out]


def compare_pdfs(a: Path, b: Path, workdir: Path) -> list[Path]:
    """Line-level text diff between two PDFs, rendered as a PDF report.

    The report is produced with PyMuPDF's Story/DocumentWriter (HTML -> PDF), so
    it needs no LibreOffice and works on the hosted platform."""
    import difflib
    import html as html_lib

    import fitz

    def read_lines(path: Path) -> list[str]:
        try:
            doc = fitz.open(str(path))
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=422, detail=f"'{path.name}' is not a valid PDF ({exc}).")
        if doc.needs_pass:
            doc.close()
            raise HTTPException(status_code=422, detail=f"'{path.name}' is password-protected.")
        lines = []
        for text in (page.get_text() for page in doc):
            lines.extend(text.splitlines())
        doc.close()
        return lines

    lines_a, lines_b = read_lines(a), read_lines(b)
    diff = list(difflib.ndiff(lines_a, lines_b))
    added = sum(1 for l in diff if l.startswith("+ "))
    removed = sum(1 for l in diff if l.startswith("- "))

    rows = []
    for line in diff:
        tag, content = line[:2], html_lib.escape(line[2:]) or "&#160;"
        if tag == "+ ":
            rows.append(f'<p class="added">+ {content}</p>')
        elif tag == "- ":
            rows.append(f'<p class="removed">- {content}</p>')
        elif tag == "  ":
            rows.append(f'<p class="same">&#160;&#160;{content}</p>')
        # "? " hint lines from ndiff are omitted — not meaningful line-for-line

    html = (
        "<html><head></head><body>"
        f"<h1>{html_lib.escape(a.name)} &#8594; {html_lib.escape(b.name)}</h1>"
        f'<p class="summary">{added} lines added, {removed} lines removed</p>'
        f'{"".join(rows)}'
        "</body></html>"
    )
    css = (
        "body { font-family: sans-serif; font-size: 10px; }"
        "h1 { font-size: 15px; }"
        ".summary { color: #555555; margin-bottom: 10px; }"
        ".added { background-color: #e6ffed; color: #22863a; padding: 1px 3px; }"
        ".removed { background-color: #ffeef0; color: #b31d28; padding: 1px 3px; }"
        ".same { color: #444444; padding: 1px 3px; }"
    )

    out = output_dir(workdir) / f"compare_{a.stem}_vs_{b.stem}.pdf"
    story = fitz.Story(html=html, user_css=css)
    writer = fitz.DocumentWriter(str(out))
    mediabox = fitz.paper_rect("a4")
    where = mediabox + (36, 36, -36, -36)
    more = 1
    while more:
        device = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(device)
        writer.end_page()
    writer.close()
    return [out]


def _resolve_page_index(page_spec: str, total: int) -> int:
    spec = (page_spec or "last").strip().lower()
    if spec == "last":
        return total - 1
    if spec == "first":
        return 0
    try:
        n = int(spec)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Invalid page '{page_spec}'. Use a page number, 'first' or 'last'.")
    if not (1 <= n <= total):
        raise HTTPException(status_code=422, detail=f"Page {n} does not exist — the document has {total} pages.")
    return n - 1


def sign_pdf(
    inputs: list[Path], workdir: Path, *,
    page: str = "last", position: str = "bottom-right", width_pt: float = 160,
    x: str | None = None, y: str | None = None,
) -> list[Path]:
    """Overlay a signature image (drawn on the frontend canvas, or uploaded
    directly) onto one page of a PDF at a chosen position and size.

    `x`/`y` are the signature's center as a fraction (0-1) of the page's
    width/height, matching the drag-to-place picker in the frontend; when
    absent, `position` (a corner/center keyword) is used instead."""
    import fitz
    from PIL import Image

    pdfs = [p for p in inputs if p.suffix.lower() == ".pdf"]
    images = [p for p in inputs if p.suffix.lower() != ".pdf"]
    if len(pdfs) != 1 or len(images) != 1:
        raise HTTPException(status_code=422, detail="Upload exactly one PDF and one signature image.")
    pdf_path, sig_path = pdfs[0], images[0]

    if position not in _POSITIONS:
        raise HTTPException(status_code=422, detail=f"Invalid position '{position}'.")
    width_pt = max(40.0, min(width_pt, 400.0))

    x_frac = y_frac = None
    if x not in (None, "") and y not in (None, ""):
        try:
            x_frac, y_frac = float(x), float(y)
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid signature position.")
        if not (0.0 <= x_frac <= 1.0 and 0.0 <= y_frac <= 1.0):
            raise HTTPException(status_code=422, detail="Signature position must be within the page.")

    try:
        doc = fitz.open(str(pdf_path))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"'{pdf_path.name}' is not a valid PDF ({exc}).")
    if doc.needs_pass:
        doc.close()
        raise HTTPException(status_code=422, detail="PDF is password-protected. Unlock it first.")

    page_idx = _resolve_page_index(page, doc.page_count)
    target = doc[page_idx]

    try:
        with Image.open(sig_path) as im:
            w, h = im.size
    except Exception as exc:  # noqa: BLE001
        doc.close()
        raise HTTPException(status_code=422, detail=f"'{sig_path.name}' is not a readable image ({exc}).")
    if w == 0 or h == 0:
        doc.close()
        raise HTTPException(status_code=422, detail="Signature image is empty.")
    height_pt = width_pt * h / w

    if x_frac is not None and y_frac is not None:
        rect_page = target.rect
        cx = rect_page.x0 + x_frac * rect_page.width
        cy = rect_page.y0 + y_frac * rect_page.height
        rect = fitz.Rect(cx - width_pt / 2, cy - height_pt / 2, cx + width_pt / 2, cy + height_pt / 2)
    else:
        ax, ay, anchor = _anchor_point(target.rect, position, margin=36)
        dx = {"left": 0.0, "center": -width_pt / 2, "right": -width_pt}[anchor]
        if position == "center":
            rect = fitz.Rect(ax - width_pt / 2, ay - height_pt / 2, ax + width_pt / 2, ay + height_pt / 2)
        elif position.startswith("top"):
            rect = fitz.Rect(ax + dx, ay, ax + dx + width_pt, ay + height_pt)
        else:  # bottom-*
            rect = fitz.Rect(ax + dx, ay - height_pt, ax + dx + width_pt, ay)

    target.insert_image(rect, filename=str(sig_path), overlay=True)
    out = output_dir(workdir) / f"{pdf_path.stem}_signed.pdf"
    doc.save(str(out))
    doc.close()
    return [out]


def unlock_pdf(src: Path, workdir: Path, password: str) -> list[Path]:
    import fitz

    out = output_dir(workdir) / f"{src.stem}_unlocked.pdf"
    try:
        doc = fitz.open(str(src))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"'{src.name}' is not a valid PDF ({exc}).")

    try:
        if doc.needs_pass:
            # authenticate() returns 0 (falsy) when the password is rejected.
            if not doc.authenticate(password or ""):
                raise HTTPException(status_code=422, detail="Wrong password for this PDF.")
        # Re-save without any encryption to strip the password.
        try:
            doc.save(str(out), encryption=fitz.PDF_ENCRYPT_NONE)
        except Exception as exc:  # noqa: BLE001 — wrong-password AES surfaces here on some files
            raise HTTPException(status_code=422, detail=f"Could not unlock '{src.name}' ({exc}).")
    finally:
        doc.close()
    return [out]
