"""HWP (Hancom Office / 한글) conversion support.

Legacy binary `.hwp` can only be *read* here: LibreOffice ships a read-only
import filter for it (`writer_MIZI_Hwp_97`) and no tool — open-source or
otherwise — can write that proprietary binary format. The modern `.hwpx`
container (a zip of XML; the format Hangul/한글 has saved by default since
2014) is fully readable *and* writable via the pure-Python `python-hwpx`
library, so every "convert to HWP" tool here produces `.hwpx` — it opens
natively in Hancom Office / 한글 and any modern HWP-compatible viewer.

Writing is a two-step pass over document HTML: `_DocumentParser` turns it into
blocks that keep the geometry HWPX can express — text alignment, page breaks,
table column widths, row heights and merged cells — and `_HwpxWriter` replays
those into a new document whose page size and margins come from the source
(`PageGeometry`). Without that geometry a converted document keeps the
template's A4 page and an evenly split, left-aligned grid for every table.
"""

from __future__ import annotations

import base64
import io
import logging
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path

from fastapi import HTTPException

from .files import output_dir
from .office import convert_with_soffice

logger = logging.getLogger(__name__)

HWP_EXTS = {".hwp", ".hwpx"}

_DATA_IMG_RE = re.compile(r"^data:image/([a-zA-Z0-9.+-]+);base64,(.+)$", re.DOTALL)

# HWPUNIT is 1/7200 inch. LibreOffice's HTML export writes lengths as CSS px
# (96 per inch) -- `<col width="207">`, `<td height="17">` -- so every size in
# the extracted HTML converts to HWPUNIT with a flat 75x factor.
_HWP_UNITS_PER_PX = 7200 / 96
_HWP_UNITS_PER_MM = 7200 / 25.4
_PT_TO_MM = 25.4 / 72
_PX_TO_MM = 25.4 / 96
_DEFAULT_MARGIN_MM = 20.0

_CSS_LENGTH_RE = re.compile(r"^\s*(-?[\d.]+)\s*(px|pt|cm|mm|in|)\s*$", re.IGNORECASE)
_TEXT_ALIGN_RE = re.compile(r"text-align\s*:\s*([a-zA-Z-]+)")
_PAGE_BREAK_RE = re.compile(r"page-break-before\s*:\s*always", re.IGNORECASE)
# `<br>` is the only real line boundary in the extracted HTML -- LibreOffice
# also wraps its output at column width, so raw newlines in the source are
# whitespace, not breaks. A sentinel keeps the two apart until text is flushed.
_LINE_BREAK = "\x00"
_STYLE_LENGTH_RE = {
    "width": re.compile(r"(?:^|;)\s*width\s*:\s*([^;]+)"),
    "height": re.compile(r"(?:^|;)\s*height\s*:\s*([^;]+)"),
}
_ALIGN_ALIASES = {
    "left": "LEFT", "start": "LEFT",
    "center": "CENTER", "centre": "CENTER", "middle": "CENTER",
    "right": "RIGHT", "end": "RIGHT",
    "justify": "JUSTIFY",
}


@dataclass(frozen=True)
class PageGeometry:
    """The page size and content margins the produced .hwpx should use, in mm.

    Without this the new document keeps python-hwpx's template page (A4 with
    template margins), which is why a Letter/legal/landscape source used to
    come back re-paginated on a different sheet size.
    """

    width_mm: float
    height_mm: float
    left_mm: float = _DEFAULT_MARGIN_MM
    right_mm: float = _DEFAULT_MARGIN_MM
    top_mm: float = _DEFAULT_MARGIN_MM
    bottom_mm: float = _DEFAULT_MARGIN_MM

    @classmethod
    def from_pt(cls, width_pt: float, height_pt: float, **margins_mm: float) -> "PageGeometry":
        return cls(width_mm=width_pt * _PT_TO_MM, height_mm=height_pt * _PT_TO_MM, **margins_mm)

    @property
    def content_width_mm(self) -> float:
        return max(self.width_mm - self.left_mm - self.right_mm, 10.0)

    @property
    def content_width_units(self) -> int:
        return round(self.content_width_mm * _HWP_UNITS_PER_MM)


def pdf_page_geometry(src: Path, max_pages: int = 10) -> "PageGeometry | None":
    """The page size of a PDF plus the margins around its actual content.

    Page size comes from the first page's media box, so the .hwpx prints on the
    same sheet as the source. The left/top margins are measured from the union
    of everything drawn on the first `max_pages` pages -- that keeps a table
    starting 84pt from the PDF's left edge starting at 84pt in the .hwpx too,
    instead of at whatever margin the template happened to carry.

    The right/bottom margins are only ever narrowed to match left/top: a
    document whose last page stops half way down, or whose lines are short,
    measures an enormous trailing margin, and honouring that would shrink the
    text area and re-wrap/re-paginate content that fits perfectly in the source.
    """
    import fitz

    try:
        doc = fitz.open(str(src))
    except Exception:  # noqa: BLE001 — geometry is best-effort; conversion still runs
        return None
    try:
        if doc.page_count == 0:
            return None
        rect = doc[0].rect
        if rect.width <= 0 or rect.height <= 0:
            return None
        content = _content_bbox(doc, max_pages)
        if content is None:
            return PageGeometry.from_pt(rect.width, rect.height)
        left_pt, top_pt, right_pt, bottom_pt = content

        def margin(value: float, extent: float) -> float:
            # A nearly-empty page would otherwise push a margin absurdly wide.
            return round(min(max(value, 0.0), extent * 0.25) * _PT_TO_MM, 1)

        left_mm = margin(left_pt, rect.width)
        top_mm = margin(top_pt, rect.height)
        return PageGeometry.from_pt(
            rect.width,
            rect.height,
            left_mm=left_mm,
            right_mm=min(margin(right_pt, rect.width), left_mm),
            top_mm=top_mm,
            bottom_mm=min(margin(bottom_pt, rect.height), top_mm),
        )
    finally:
        doc.close()


def _content_bbox(doc, max_pages: int) -> "tuple[float, float, float, float] | None":  # noqa: ANN001
    """Whitespace around everything drawn on the first `max_pages` pages, as
    (left, top, right, bottom) gaps in points. Coordinates are unioned by hand
    rather than with `fitz.Rect` arithmetic because a table's border strokes are
    zero-width/height rects, which `Rect.is_empty` (and therefore `|`) drops."""
    left = top = right = bottom = None
    for page in list(doc)[:max_pages]:
        page_rect = page.rect
        boxes = [tuple(block[:4]) for block in page.get_text("blocks")]
        try:
            boxes += [tuple(drawing["rect"]) for drawing in page.get_drawings()]
        except Exception:  # noqa: BLE001 — malformed drawing stream
            pass
        for x0, y0, x1, y1 in boxes:
            box_left = max(min(x0, x1), page_rect.x0)
            box_right = min(max(x0, x1), page_rect.x1)
            box_top = max(min(y0, y1), page_rect.y0)
            box_bottom = min(max(y0, y1), page_rect.y1)
            if box_right < box_left or box_bottom < box_top:
                continue  # entirely outside the page
            gaps = (
                box_left - page_rect.x0,
                box_top - page_rect.y0,
                page_rect.x1 - box_right,
                page_rect.y1 - box_bottom,
            )
            left = gaps[0] if left is None else min(left, gaps[0])
            top = gaps[1] if top is None else min(top, gaps[1])
            right = gaps[2] if right is None else min(right, gaps[2])
            bottom = gaps[3] if bottom is None else min(bottom, gaps[3])
    if left is None:
        return None
    return (left, top, right, bottom)


def _css_length_px(value: "str | None") -> "float | None":
    """A CSS/HTML length as px. Percentages and `auto` return None."""
    if not value:
        return None
    match = _CSS_LENGTH_RE.match(str(value))
    if not match:
        return None
    number = float(match.group(1))
    unit = match.group(2).lower()
    factor = {
        "": 1.0, "px": 1.0,
        "pt": 96 / 72,
        "cm": 96 / 2.54,
        "mm": 96 / 25.4,
        "in": 96.0,
    }[unit]
    px = number * factor
    return px if px > 0 else None


def _attr_length_px(attrs: dict, name: str) -> "float | None":
    """A width/height taken from the attribute, or from `style` if absent."""
    px = _css_length_px(attrs.get(name))
    if px is not None:
        return px
    match = _STYLE_LENGTH_RE[name].search(attrs.get("style") or "")
    return _css_length_px(match.group(1)) if match else None


def _attr_alignment(attrs: dict) -> "str | None":
    """`align="right"` or `style="text-align:right"` as an HWP alignment name."""
    raw = (attrs.get("align") or "").strip().lower()
    if not raw:
        match = _TEXT_ALIGN_RE.search(attrs.get("style") or "")
        raw = match.group(1).lower() if match else ""
    return _ALIGN_ALIASES.get(raw)


def _attr_int(attrs: dict, name: str, default: int = 1) -> int:
    try:
        return max(int(str(attrs.get(name, default)).strip()), 1)
    except (TypeError, ValueError):
        return default


@dataclass
class _Para:
    text: str
    align: "str | None" = None
    level: int = 0  # 0 = body text, 1-6 = heading level
    page_break: bool = False


@dataclass
class _Cell:
    text: str = ""
    align: "str | None" = None
    row_span: int = 1
    col_span: int = 1
    width_px: "float | None" = None
    height_px: "float | None" = None


@dataclass
class _Table:
    rows: list[list[_Cell]] = field(default_factory=list)
    col_widths_px: list[float] = field(default_factory=list)
    width_px: "float | None" = None


@dataclass
class _Picture:
    data: bytes
    fmt: str
    width_mm: "float | None" = None
    height_mm: "float | None" = None


class _DocumentParser(HTMLParser):
    """Parses document HTML into blocks (paragraphs, tables, pictures) keeping
    the geometry HWPX can reproduce: text alignment, table/column widths, row
    heights and merged cells. Parsing is kept separate from writing so a table
    is only emitted once its full grid — and therefore its column count — is
    known."""

    _HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
    _BLOCK_TAGS = {"p", "div", "li"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[object] = []
        self._buf: list[str] = []
        self._align: "str | None" = None
        self._heading: int = 0
        self._page_break = False
        self._skip_depth = 0
        self._table: "_Table | None" = None
        self._table_depth = 0
        self._row: "list[_Cell] | None" = None
        self._row_height_px: "float | None" = None
        self._cell: "_Cell | None" = None
        # Pictures found inside a cell: HWPX has no inline-in-cell picture
        # here, so they are emitted right after the table instead of dropped.
        self._deferred: list[_Picture] = []

    # ---------------------------------------------------------------- parsing

    def handle_starttag(self, tag: str, attrs) -> None:  # noqa: ANN001
        attrs_d = {name: (value or "") for name, value in attrs}
        if tag in ("script", "style"):
            self._skip_depth += 1
            return
        if tag == "table":
            self._start_table(attrs_d)
            return
        if self._table is not None and self._table_depth == 1:
            if tag == "col":
                width = _attr_length_px(attrs_d, "width")
                if width:
                    self._table.col_widths_px.append(width)
                return
            if tag == "tr":
                self._row = []
                self._row_height_px = _attr_length_px(attrs_d, "height")
                return
            if tag in ("td", "th"):
                self._cell = _Cell(
                    align=_attr_alignment(attrs_d),
                    row_span=_attr_int(attrs_d, "rowspan"),
                    col_span=_attr_int(attrs_d, "colspan"),
                    width_px=_attr_length_px(attrs_d, "width"),
                    height_px=_attr_length_px(attrs_d, "height") or self._row_height_px,
                )
                self._buf = []
                return
        if tag == "img":
            self._add_picture(attrs_d)
            return
        if tag == "br":
            self._buf.append(_LINE_BREAK)
            return
        if self._cell is not None:
            # Cell content: keep the text, and adopt the alignment of the
            # first block inside the cell when the <td> itself carried none
            # (LibreOffice puts it on the cell's <p>, not the <td>).
            if tag in self._BLOCK_TAGS or tag in self._HEADING_TAGS:
                if self._cell.align is None:
                    self._cell.align = _attr_alignment(attrs_d)
            return
        if tag in self._HEADING_TAGS or tag in self._BLOCK_TAGS:
            self._flush_paragraph()
            self._heading = int(tag[1]) if tag in self._HEADING_TAGS else 0
            self._align = _attr_alignment(attrs_d)
            # pdf2docx marks every original page boundary with a hard break;
            # carrying it over is what keeps the .hwpx paginated like the source.
            self._page_break = bool(_PAGE_BREAK_RE.search(attrs_d.get("style") or ""))

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style"):
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if tag == "table" and self._table is not None:
            self._end_table()
            return
        if self._table is not None and self._table_depth == 1:
            if tag in ("td", "th") and self._cell is not None:
                self._cell.text = self._flush_text()
                if self._row is None:
                    self._row = []
                self._row.append(self._cell)
                self._cell = None
                return
            if tag == "tr":
                if self._row:
                    self._table.rows.append(self._row)
                self._row = None
                return
        if self._cell is not None:
            return
        if tag in self._HEADING_TAGS or tag in self._BLOCK_TAGS:
            self._flush_paragraph()

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        self._buf.append(data)

    def close(self) -> None:  # noqa: D102 — flush whatever the document ended mid-way through
        super().close()
        if self._table is not None:
            self._end_table()
        self._flush_paragraph()

    # --------------------------------------------------------------- internals

    def _start_table(self, attrs: dict) -> None:
        if self._table is not None:
            # Nested table: no HWPX equivalent worth guessing at, so its text
            # keeps flowing into the cell that contains it.
            self._table_depth += 1
            return
        self._flush_paragraph()
        self._table = _Table(width_px=_attr_length_px(attrs, "width"))
        self._table_depth = 1
        self._row = None
        self._cell = None

    def _end_table(self) -> None:
        if self._table_depth > 1:
            self._table_depth -= 1
            return
        table = self._table
        self._table = None
        self._table_depth = 0
        if table is not None and table.rows:
            self.blocks.append(table)
        self.blocks.extend(self._deferred)
        self._deferred = []

    def _flush_text(self) -> str:
        return " ".join(line for line in self._flush_lines() if line)

    def _flush_lines(self) -> list[str]:
        """The buffered text split on `<br>`, whitespace collapsed. A trailing
        break (`…<br></p>`) adds no line, so its empty tail is dropped."""
        raw = "".join(self._buf)
        self._buf = []
        lines = [re.sub(r"\s+", " ", part).strip() for part in raw.split(_LINE_BREAK)]
        if len(lines) > 1 and not lines[-1]:
            lines.pop()
        if not any(lines) and _LINE_BREAK not in raw:
            # Nothing but the whitespace between two tags: a block boundary, not
            # a blank line of the document.
            return []
        return lines

    def _flush_paragraph(self) -> None:
        lines = self._flush_lines()
        level, self._heading = self._heading, 0
        align, self._align = self._align, None
        page_break, self._page_break = self._page_break, False
        if not lines:
            if page_break:
                # An empty block can still carry the page break; keep it so the
                # writer can hand the break to whatever starts that page.
                lines = [""]
            else:
                return
        for index, line in enumerate(lines):
            self.blocks.append(_Para(
                text=line,
                align=align,
                level=level if index == 0 else 0,
                page_break=page_break and index == 0,
            ))

    def _add_picture(self, attrs: dict) -> None:
        match = _DATA_IMG_RE.match(attrs.get("src", ""))
        if not match:
            return
        fmt = match.group(1).lower()
        try:
            data = base64.b64decode(match.group(2))
        except Exception:  # noqa: BLE001
            return
        # Prefer the size the document lays the image out at; fall back to the
        # image's own pixel size read at 96 dpi.
        width_px = _attr_length_px(attrs, "width")
        height_px = _attr_length_px(attrs, "height")
        width_mm = width_px * _PX_TO_MM if width_px else None
        height_mm = height_px * _PX_TO_MM if height_px else None
        if width_mm is None or height_mm is None:
            try:
                from PIL import Image

                with Image.open(io.BytesIO(data)) as image:
                    intrinsic_w = image.width * _PX_TO_MM
                    intrinsic_h = image.height * _PX_TO_MM
                aspect = intrinsic_h / intrinsic_w if intrinsic_w else None
                if width_mm is None and height_mm is None:
                    width_mm, height_mm = intrinsic_w, intrinsic_h
                elif width_mm is None and aspect:
                    width_mm = height_mm / aspect
                elif height_mm is None and aspect:
                    height_mm = width_mm * aspect
            except Exception:  # noqa: BLE001 — unreadable image: let the writer decide
                pass
        picture = _Picture(data=data, fmt="jpeg" if fmt == "jpg" else fmt,
                           width_mm=width_mm, height_mm=height_mm)
        if self._cell is not None or self._table is not None:
            self._deferred.append(picture)
        else:
            self.blocks.append(picture)


def _grid_placements(rows: list[list[_Cell]]) -> "tuple[list[tuple[int, int, _Cell]], int, int]":
    """Place HTML rows (which omit cells covered by a span) on a logical grid.
    Returns [(row, col, cell)] plus the grid's row and column count."""
    occupied: set[tuple[int, int]] = set()
    placements: list[tuple[int, int, _Cell]] = []
    for row_index, row in enumerate(rows):
        col = 0
        for cell in row:
            while (row_index, col) in occupied:
                col += 1
            for dr in range(cell.row_span):
                for dc in range(cell.col_span):
                    occupied.add((row_index + dr, col + dc))
            placements.append((row_index, col, cell))
            col += cell.col_span
    if not occupied:
        return [], 0, 0
    row_count = max(r for r, _ in occupied) + 1
    col_count = max(c for _, c in occupied) + 1
    return placements, row_count, col_count


def _column_widths_px(
    table: _Table, placements: list[tuple[int, int, _Cell]], col_count: int
) -> "list[float] | None":
    """Per-column widths in px: `<col width>` when the source provides one per
    column, otherwise inferred from the un-merged cells of each column."""
    if len(table.col_widths_px) == col_count and all(w > 0 for w in table.col_widths_px):
        return list(table.col_widths_px)
    widths: list[float | None] = [None] * col_count
    for _row, col, cell in placements:
        if cell.col_span == 1 and cell.width_px and widths[col] is None:
            widths[col] = cell.width_px
    known = [w for w in widths if w]
    if not known:
        return None
    fallback = sum(known) / len(known)
    return [w if w else fallback for w in widths]


class _HwpxWriter:
    """Writes parsed blocks into a new `HwpxDocument`."""

    def __init__(self, doc, page: "PageGeometry | None") -> None:  # noqa: ANN001
        self.doc = doc
        self.page = page
        self._para_pr_ids: dict[tuple[str, bool], "str | None"] = {}
        # A page's leading blank lines are already accounted for by the top
        # margin, so they are skipped -- but the page break one of them carries
        # has to move on to whatever actually starts that page.
        self._at_page_start = True
        self._pending_break = False

    def write(self, blocks: list[object]) -> None:
        for block in blocks:
            if isinstance(block, _Para):
                self._write_paragraph(block)
            elif isinstance(block, _Table):
                self._write_table(block)
            elif isinstance(block, _Picture):
                self._write_picture(block)

    def _take_break(self, own_break: bool) -> bool:
        page_break = own_break or self._pending_break
        self._pending_break = False
        return page_break

    # -------------------------------------------------------------- paragraphs

    def _para_pr_id(self, align: str, page_break: bool = False) -> "str | None":
        """A paragraph-property id with this alignment (and page break), minted
        once per combination. These are the same header calls
        `doc.styles.apply_paragraph_format` makes, used directly because that
        helper only addresses body paragraphs by index — table cells and table
        anchors need the id itself."""
        key = (align, page_break)
        if key not in self._para_pr_ids:
            header = self.doc.oxml.headers[0]
            try:
                if page_break:
                    self._para_pr_ids[key] = header.ensure_paragraph_format(
                        alignment=align, break_setting={"page_break_before": True}
                    )
                else:
                    self._para_pr_ids[key] = header.ensure_paragraph_alignment(align)
            except Exception:  # noqa: BLE001 — formatting is cosmetic, never fatal
                logger.debug("hwpx: could not create a %s paragraph property", align, exc_info=True)
                self._para_pr_ids[key] = None
        return self._para_pr_ids[key]

    def _apply_format(self, paragraph, align: str, page_break: bool = False) -> None:  # noqa: ANN001
        para_pr_id = self._para_pr_id(align, page_break)
        if para_pr_id is None:
            return
        try:
            paragraph.para_pr_id_ref = para_pr_id
        except Exception:  # noqa: BLE001
            logger.debug("hwpx: could not apply a %s paragraph property", align, exc_info=True)

    def _write_paragraph(self, para: _Para) -> None:
        if not para.text:
            # Blank lines are the source's vertical spacing, so they are kept --
            # except at the top of a page, where the top margin already accounts
            # for them (the break they carry still moves on to the real content).
            if para.page_break:
                self._pending_break = True
                self._at_page_start = True
                return
            if self._at_page_start:
                return
        page_break = self._take_break(para.page_break)
        if para.level:
            paragraph = self.doc.add_heading(para.text, level=min(para.level, 6))
            if para.align or page_break:
                self._apply_format(paragraph, para.align or "LEFT", page_break)
        else:
            paragraph = self.doc.add_paragraph(para.text)
            # Always explicit, never inherited: `add_paragraph` copies the
            # previous paragraph's properties, so one right-aligned line would
            # otherwise drag every following line right with it.
            self._apply_format(paragraph, para.align or "LEFT", page_break)
        if para.text:
            self._at_page_start = False

    def _write_picture(self, picture: _Picture) -> None:
        self._at_page_start = False
        width_mm, height_mm = picture.width_mm, picture.height_mm
        if self.page is not None and width_mm and width_mm > self.page.content_width_mm:
            scale = self.page.content_width_mm / width_mm
            width_mm = self.page.content_width_mm
            height_mm = height_mm * scale if height_mm else None
        try:
            self.doc.add_picture(picture.data, picture.fmt, width_mm=width_mm, height_mm=height_mm)
        except Exception:  # noqa: BLE001 — an image the writer can't embed shouldn't fail the document
            logger.debug("hwpx: could not embed a %s image", picture.fmt, exc_info=True)

    # ------------------------------------------------------------------ tables

    def _write_table(self, table: _Table) -> None:
        placements, row_count, col_count = _grid_placements(table.rows)
        if not placements:
            return
        col_widths = _column_widths_px(table, placements, col_count)
        total_px = table.width_px or (sum(col_widths) if col_widths else None)
        width_units = round(total_px * _HWP_UNITS_PER_PX) if total_px else None
        if width_units and self.page is not None:
            # A table wider than the printable area would run off the sheet;
            # scaling it keeps every column's share of the width intact.
            width_units = min(width_units, self.page.content_width_units)
        row_heights = self._row_heights_units(table.rows, row_count)
        height_units = sum(row_heights) or None

        page_break = self._take_break(False)
        try:
            hwpx_table = self.doc.add_table(
                row_count, col_count, width=width_units, height=height_units
            )
        except Exception:  # noqa: BLE001
            logger.warning("hwpx: could not create a %dx%d table", row_count, col_count, exc_info=True)
            return
        self._at_page_start = False
        if page_break:
            # The break belongs to the paragraph the table is anchored in.
            self._apply_format(hwpx_table.paragraph, "LEFT", True)

        if col_widths and sum(col_widths) > 0:
            try:
                hwpx_table.set_column_widths(col_widths)
            except Exception:  # noqa: BLE001 — keep the evenly-split default
                logger.debug("hwpx: could not set column widths", exc_info=True)
        self._apply_row_heights(hwpx_table, row_heights)
        # Merge before writing text so the logical addressing below resolves to
        # the merged anchor cells — and after the heights, so each merged cell
        # picks up the summed height of the rows it covers.
        for row, col, cell in placements:
            if cell.row_span > 1 or cell.col_span > 1:
                try:
                    hwpx_table.merge_cells(row, col, row + cell.row_span - 1, col + cell.col_span - 1)
                except Exception:  # noqa: BLE001 — leave the cells un-merged
                    logger.debug("hwpx: could not merge cells at %d,%d", row, col, exc_info=True)
        grid = _logical_cells(hwpx_table)
        for row, col, cell in placements:
            self._write_cell(hwpx_table, grid, row, col, cell)

    def _row_heights_units(self, rows: list[list[_Cell]], row_count: int) -> list[int]:
        heights = [0] * row_count
        for index, row in enumerate(rows[:row_count]):
            tallest = max((cell.height_px or 0) for cell in row) if row else 0
            heights[index] = round(tallest * _HWP_UNITS_PER_PX)
        return heights

    def _apply_row_heights(self, hwpx_table, heights: list[int]) -> None:  # noqa: ANN001
        if not any(heights):
            return
        try:
            rows = hwpx_table.rows
        except Exception:  # noqa: BLE001
            return
        for index, row in enumerate(rows):
            height = heights[index] if index < len(heights) else 0
            if not height:
                continue
            for cell in row.cells:
                try:
                    cell.set_size(height=height)
                except Exception:  # noqa: BLE001
                    logger.debug("hwpx: could not set row height", exc_info=True)

    def _write_cell(self, hwpx_table, grid: dict, row: int, col: int, cell: _Cell) -> None:  # noqa: ANN001
        if cell.text:
            try:
                hwpx_table.set_cell_text(row, col, cell.text, logical=True)
            except Exception:  # noqa: BLE001
                logger.debug("hwpx: could not fill cell %d,%d", row, col, exc_info=True)
                return
        target = grid.get((row, col)) if cell.align else None
        if target is None:
            return
        for paragraph in target.paragraphs:
            self._apply_format(paragraph, cell.align)


def _logical_cells(hwpx_table) -> dict:  # noqa: ANN001
    """Logical (row, column) -> cell, so filling an N-cell table stays linear
    instead of re-walking the grid once per cell."""
    try:
        return {(entry.row, entry.column): entry.cell for entry in hwpx_table.iter_grid()}
    except Exception:  # noqa: BLE001
        logger.debug("hwpx: could not map the table grid", exc_info=True)
        return {}


def _apply_page_geometry(doc, page: PageGeometry) -> None:  # noqa: ANN001
    try:
        doc.page.setup(
            width_mm=page.width_mm,
            height_mm=page.height_mm,
            orientation="WIDELY" if page.width_mm > page.height_mm else "PORTRAIT",
            margins_mm={
                "left": page.left_mm,
                "right": page.right_mm,
                "top": page.top_mm,
                "bottom": page.bottom_mm,
            },
        )
    except Exception:  # noqa: BLE001 — a template-sized page beats no document
        logger.warning("hwpx: could not apply page geometry", exc_info=True)


def hwp_to_html(src: Path, workdir: Path) -> str:
    """Read a .hwp/.hwpx file's content as HTML, for feeding the shared
    document-export pipeline (`html_edit.export_html`)."""
    ext = src.suffix.lower()
    if ext == ".hwpx":
        import hwpx

        try:
            doc = hwpx.HwpxDocument.open(str(src))
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=422, detail=f"'{src.name}' is not a valid HWPX file ({exc}).")
        try:
            # python-hwpx returns a whole <html> document; every caller here
            # wants body content only (the document editor injects it into a
            # contenteditable page, the export pipeline re-wraps it).
            from .html_edit import _BODY_RE

            full = doc.text.html()
            body = _BODY_RE.search(full)
            return (body.group(1) if body else full).strip()
        finally:
            doc.close()
    if ext == ".hwp":
        # `_office_to_html` already does exactly what's needed here (LibreOffice
        # HTML export + inlining referenced images as data URIs) -- .hwp goes
        # through the very same soffice `--convert-to html` path as .docx etc.
        from .html_edit import _office_to_html

        return _office_to_html(src, workdir)
    raise HTTPException(status_code=422, detail=f"'{src.name}' isn't a .hwp or .hwpx file.")


def hwp_to_pdf(src: Path, workdir: Path) -> list[Path]:
    """Convert a .hwp/.hwpx file to PDF."""
    from .html_edit import export_html, render_html_to_pdf
    from .office import find_soffice

    # Legacy .hwp: LibreOffice imports AND renders straight to PDF in one
    # step -- best fidelity, no need for an HTML round-trip.
    if src.suffix.lower() == ".hwp":
        return [convert_with_soffice(src, output_dir(workdir), "pdf")]

    html = hwp_to_html(src, workdir)
    if find_soffice():
        return [export_html(html, "pdf", src.stem, workdir)]
    out = output_dir(workdir) / f"{src.stem}.pdf"
    return [render_html_to_pdf(html, out)]


def html_to_hwpx(
    html: str, stem: str, workdir: Path, *, page: "PageGeometry | None" = None
) -> Path:
    """Build a new .hwpx document from document HTML — headings, paragraphs and
    their alignment, tables with their real column widths / row heights /
    merged cells, and inlined base64 images. `page` reproduces the source's
    sheet size and content margins; without it the template's page is kept."""
    import hwpx

    doc = hwpx.HwpxDocument.new()
    if page is not None:
        _apply_page_geometry(doc, page)
    parser = _DocumentParser()
    parser.feed(html)
    parser.close()
    _HwpxWriter(doc, page).write(parser.blocks)
    out = output_dir(workdir) / f"{stem}.hwpx"
    doc.save_to_path(out)
    doc.close()
    return out


def pdf_to_hwpx(src: Path, workdir: Path) -> list[Path]:
    """Convert a PDF to .hwpx, reusing the document editor's structure-aware
    PDF -> HTML extraction (pdf2docx + LibreOffice, or the positioned-text
    fallback) as the source of truth, on a page matching the PDF's own."""
    from .html_edit import extract_html

    html = extract_html(src, workdir)
    return [html_to_hwpx(html, src.stem, workdir, page=pdf_page_geometry(src))]
