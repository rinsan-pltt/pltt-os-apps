export interface PageSize {
  key: string;
  label: string;
  wmm: number;
  hmm: number;
}

// ISO + US paper sizes (mm). Preview renders at a fixed px-per-mm scale, so a
// larger sheet is physically bigger on screen and holds more content per page.
export const PAGE_SIZES: PageSize[] = [
  { key: "a4", label: "A4", wmm: 210, hmm: 297 },
  { key: "letter", label: "Letter", wmm: 216, hmm: 279 },
  { key: "b4", label: "B4", wmm: 250, hmm: 353 },
  { key: "a3", label: "A3", wmm: 297, hmm: 420 },
];

export const DEFAULT_PAGE_SIZE = "a4";

// px per mm at TRUE physical size (CSS 96dpi → 96/25.4). At zoom=1 the preview
// is rendered at 100% physical size, so px font sizes match the PDF export.
export const PX_PER_MM = 96 / 25.4;

export function getPageSize(key?: string): PageSize {
  return PAGE_SIZES.find((p) => p.key === key) ?? PAGE_SIZES[0];
}

// CSS @page size names for WeasyPrint export
export const CSS_PAGE_SIZE: Record<string, string> = {
  a4: "A4",
  a3: "A3",
  b4: "B4",
  letter: "Letter",
};
