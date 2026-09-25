/**
 * Structural editing for the spreadsheet grids the document editor renders
 * (see api/core/sheet_grid.py for the markup, and EditorToolbox for the UI).
 *
 * Everything works through a MATRIX view of the table: `matrix[r][c]` holds
 * the `<td>` that occupies that grid square, with a merged cell's element
 * repeated across every square it covers. Inserting, deleting and merging are
 * then ordinary array operations, and `writeMatrix` derives each cell's real
 * `rowspan`/`colspan` back from how many squares still hold the same element.
 * Doing it this way is what keeps merged cells correct when a row or column
 * is added or removed through the middle of them.
 *
 * The same `<td>` nodes are moved, never recreated, so a cell keeps the typed
 * value (`data-t`/`data-v`) the backend recorded for it and the round trip
 * back to .xlsx stays lossless.
 */

/** 1 -> A, 27 -> AA. Mirrors `column_letter` in api/core/sheet_grid.py. */
export function columnLetter(index: number): string {
  let letters = ""
  let n = index
  while (n > 0) {
    const rem = (n - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

/** The grid a cell belongs to, or null when the node isn't in one. */
export function gridOf(node: Node | null): HTMLTableElement | null {
  const el = node instanceof Element ? node : node?.parentElement ?? null
  return el?.closest<HTMLTableElement>("table.xl-grid") ?? null
}

/** The data cell containing `node` (never a row/column header). */
export function cellOf(node: Node | null): HTMLTableCellElement | null {
  const el = node instanceof Element ? node : node?.parentElement ?? null
  return el?.closest<HTMLTableCellElement>("td[data-cell]") ?? null
}

function bodyRows(table: HTMLTableElement): HTMLTableRowElement[] {
  return Array.from(table.tBodies[0]?.rows ?? [])
}

interface Grid {
  /** `cells[r][c]` = the `<td>` occupying that square (repeated across spans). */
  cells: HTMLTableCellElement[][]
  /** Each row's own inline style (its height), carried with the row so an
   *  insert or delete doesn't shift every height below it by one row. */
  rowStyles: (string | null)[]
}

function readMatrix(table: HTMLTableElement): Grid {
  const matrix: HTMLTableCellElement[][] = []
  const rowStyles: (string | null)[] = []
  bodyRows(table).forEach((tr, r) => {
    rowStyles[r] = tr.getAttribute("style")
    matrix[r] = matrix[r] ?? []
    let c = 0
    Array.from(tr.cells).forEach((cell) => {
      if (cell.tagName !== "TD") return // the row-number gutter
      const td = cell as HTMLTableCellElement
      while (matrix[r][c]) c += 1 // a merge from an earlier row already sits here
      const rowSpan = Math.max(1, td.rowSpan || 1)
      const colSpan = Math.max(1, td.colSpan || 1)
      for (let dr = 0; dr < rowSpan; dr += 1) {
        matrix[r + dr] = matrix[r + dr] ?? []
        for (let dc = 0; dc < colSpan; dc += 1) matrix[r + dr][c + dc] = td
      }
      c += colSpan
    })
  })
  // Square the matrix off: a ragged row would silently drop columns on write.
  const width = matrix.reduce((max, row) => Math.max(max, row.length), 0)
  matrix.forEach((row) => {
    for (let c = 0; c < width; c += 1) if (!row[c]) row[c] = createCell()
  })
  return { cells: matrix, rowStyles }
}

/** Rebuild the table's rows from `grid`, deriving every span from it. */
function writeMatrix(table: HTMLTableElement, grid: Grid): void {
  const tbody = table.tBodies[0]
  if (!tbody) return
  const matrix = grid.cells
  const rows = matrix.length
  const cols = matrix[0]?.length ?? 0
  const fragment = document.createDocumentFragment()

  for (let r = 0; r < rows; r += 1) {
    const tr = document.createElement("tr")
    const style = grid.rowStyles[r]
    if (style) tr.setAttribute("style", style)
    const gutter = document.createElement("th")
    gutter.className = "xl-rowhead"
    gutter.setAttribute("contenteditable", "false")
    gutter.textContent = String(r + 1)
    tr.appendChild(gutter)

    for (let c = 0; c < cols; c += 1) {
      const td = matrix[r][c]
      const isAnchor = (r === 0 || matrix[r - 1][c] !== td) && (c === 0 || matrix[r][c - 1] !== td)
      if (!isAnchor) continue
      let colSpan = 1
      while (c + colSpan < cols && matrix[r][c + colSpan] === td) colSpan += 1
      let rowSpan = 1
      while (r + rowSpan < rows && matrix[r + rowSpan][c] === td) rowSpan += 1
      if (colSpan > 1) td.setAttribute("colspan", String(colSpan))
      else td.removeAttribute("colspan")
      if (rowSpan > 1) td.setAttribute("rowspan", String(rowSpan))
      else td.removeAttribute("rowspan")
      td.setAttribute("data-cell", `${columnLetter(c + 1)}${r + 1}`)
      tr.appendChild(td)
    }
    fragment.appendChild(tr)
  }

  tbody.replaceChildren(fragment)
  syncHeader(table, cols)
}

/** Keep the A/B/C header row and the `<colgroup>` in step with the grid. */
function syncHeader(table: HTMLTableElement, cols: number): void {
  const headRow = table.tHead?.rows[0]
  if (headRow) {
    const heads = Array.from(headRow.cells).filter((th) => th.classList.contains("xl-colhead"))
    for (let i = heads.length; i < cols; i += 1) {
      const th = document.createElement("th")
      th.className = "xl-colhead"
      th.setAttribute("contenteditable", "false")
      headRow.appendChild(th)
    }
    for (let i = heads.length - 1; i >= cols; i -= 1) heads[i].remove()
    Array.from(headRow.cells)
      .filter((th) => th.classList.contains("xl-colhead"))
      .forEach((th, i) => {
        th.textContent = columnLetter(i + 1)
      })
  }
  const colgroup = table.querySelector("colgroup")
  if (colgroup) {
    const widths = Array.from(colgroup.children).filter(
      (col) => !col.classList.contains("xl-gutter-col"),
    )
    for (let i = widths.length; i < cols; i += 1) {
      const col = document.createElement("col")
      col.setAttribute("style", "width:80px")
      colgroup.appendChild(col)
    }
    for (let i = widths.length - 1; i >= cols; i -= 1) widths[i].remove()
  }
}

/** A fresh, empty data cell — optionally inheriting a neighbour's formatting,
 *  the way a new Excel row picks up the formatting of the row it came from. */
function createCell(styleFrom?: HTMLTableCellElement | null): HTMLTableCellElement {
  const td = document.createElement("td")
  const style = styleFrom?.getAttribute("style")
  if (style) td.setAttribute("style", style)
  return td
}

/** 0-based (row, col) of `td` within its grid, from its `A1` reference. */
export function cellIndex(td: HTMLTableCellElement): { row: number; col: number } | null {
  const ref = td.getAttribute("data-cell") || ""
  const match = /^([A-Z]+)(\d+)$/.exec(ref)
  if (!match) return null
  let col = 0
  for (const ch of match[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { row: Number(match[2]) - 1, col: col - 1 }
}

/** Every cell the current selection touches — or just the caret's cell when
 *  nothing is selected. Cells are returned in document order. */
export function selectedCells(table: HTMLTableElement, active: HTMLTableCellElement | null): HTMLTableCellElement[] {
  const selection = typeof window !== "undefined" ? window.getSelection() : null
  const all = Array.from(table.querySelectorAll<HTMLTableCellElement>("td[data-cell]"))
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
    const touched = all.filter((td) => selection.containsNode(td, true))
    if (touched.length > 0) return touched
  }
  return active && table.contains(active) ? [active] : []
}

export function insertRow(table: HTMLTableElement, at: number, where: "above" | "below"): void {
  const grid = readMatrix(table)
  const matrix = grid.cells
  if (matrix.length === 0) return
  const index = Math.min(Math.max(where === "above" ? at : at + 1, 0), matrix.length)
  const cols = matrix[0].length
  const row: HTMLTableCellElement[] = []
  for (let c = 0; c < cols; c += 1) {
    // A merged cell spanning across the insertion line grows by a row rather
    // than being cut in half by one.
    const above = index > 0 ? matrix[index - 1][c] : null
    const below = index < matrix.length ? matrix[index][c] : null
    row[c] = above && above === below ? above : createCell(above)
  }
  matrix.splice(index, 0, row)
  grid.rowStyles.splice(index, 0, grid.rowStyles[Math.max(0, index - 1)] ?? null)
  writeMatrix(table, grid)
}

export function deleteRow(table: HTMLTableElement, at: number): void {
  const grid = readMatrix(table)
  if (grid.cells.length <= 1 || at < 0 || at >= grid.cells.length) return
  grid.cells.splice(at, 1)
  grid.rowStyles.splice(at, 1)
  writeMatrix(table, grid)
}

export function insertColumn(table: HTMLTableElement, at: number, where: "left" | "right"): void {
  const grid = readMatrix(table)
  const matrix = grid.cells
  if (matrix.length === 0) return
  const cols = matrix[0].length
  const index = Math.min(Math.max(where === "left" ? at : at + 1, 0), cols)
  matrix.forEach((row) => {
    const left = index > 0 ? row[index - 1] : null
    const right = index < row.length ? row[index] : null
    row.splice(index, 0, left && left === right ? left : createCell(left))
  })
  const colgroup = table.querySelector("colgroup")
  if (colgroup) {
    const col = document.createElement("col")
    col.setAttribute("style", "width:80px")
    const siblings = Array.from(colgroup.children).filter((c) => !c.classList.contains("xl-gutter-col"))
    colgroup.insertBefore(col, siblings[index] ?? null)
  }
  writeMatrix(table, grid)
}

export function deleteColumn(table: HTMLTableElement, at: number): void {
  const grid = readMatrix(table)
  const cols = grid.cells[0]?.length ?? 0
  if (cols <= 1 || at < 0 || at >= cols) return
  grid.cells.forEach((row) => row.splice(at, 1))
  const colgroup = table.querySelector("colgroup")
  if (colgroup) {
    const siblings = Array.from(colgroup.children).filter((c) => !c.classList.contains("xl-gutter-col"))
    siblings[at]?.remove()
  }
  writeMatrix(table, grid)
}

/** Merge the selection into one cell. Like Excel, only the top-left cell's
 *  content survives. Returns false when there is nothing to merge. */
export function mergeCells(table: HTMLTableElement, cells: HTMLTableCellElement[]): boolean {
  if (cells.length < 2) return false
  const grid = readMatrix(table)
  const matrix = grid.cells
  const chosen = new Set(cells)
  let top = Infinity
  let left = Infinity
  let bottom = -1
  let right = -1
  matrix.forEach((row, r) =>
    row.forEach((td, c) => {
      if (!chosen.has(td)) return
      top = Math.min(top, r)
      left = Math.min(left, c)
      bottom = Math.max(bottom, r)
      right = Math.max(right, c)
    }),
  )
  if (bottom < 0 || (top === bottom && left === right)) return false
  const anchor = matrix[top][left]
  // A merged cell holds one value; drop the others' recorded values too, or
  // export would write the anchor's text back with a neighbour's typed value.
  for (let r = top; r <= bottom; r += 1) {
    for (let c = left; c <= right; c += 1) matrix[r][c] = anchor
  }
  writeMatrix(table, grid)
  return true
}

/** Split a merged cell back into individual ones (blank, same formatting). */
export function unmergeCell(table: HTMLTableElement, td: HTMLTableCellElement): boolean {
  if ((td.rowSpan || 1) === 1 && (td.colSpan || 1) === 1) return false
  const grid = readMatrix(table)
  let first = true
  grid.cells.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell !== td) return
      if (first) {
        first = false
        return
      }
      grid.cells[r][c] = createCell(td)
    }),
  )
  writeMatrix(table, grid)
  return true
}

/** Empty the given cells — text and the typed value the backend recorded for
 *  them, which no longer describes what the cell holds. */
export function clearCells(cells: HTMLTableCellElement[]): void {
  cells.forEach((td) => {
    td.textContent = ""
    td.removeAttribute("data-t")
    td.removeAttribute("data-v")
    td.removeAttribute("data-d")
  })
}

/** Set (or, when every cell already has it, unset) one inline style on each
 *  cell. Cell formatting lives in the `<td>`'s own style because that is what
 *  the .xlsx export reads back — a `<b>` inside the cell would not survive. */
export function toggleCellStyle(
  cells: HTMLTableCellElement[],
  property: string,
  value: string,
): void {
  if (cells.length === 0) return
  const allSet = cells.every((td) => td.style.getPropertyValue(property) === value)
  cells.forEach((td) => {
    if (allSet) td.style.removeProperty(property)
    else td.style.setProperty(property, value)
  })
}

/** Set one inline style on each cell (no toggling) — for colors. */
export function setCellStyle(cells: HTMLTableCellElement[], property: string, value: string): void {
  cells.forEach((td) => td.style.setProperty(property, value))
}

/** Drop every style a cell carries, leaving its text. */
export function clearCellFormatting(cells: HTMLTableCellElement[]): void {
  cells.forEach((td) => td.removeAttribute("style"))
}
