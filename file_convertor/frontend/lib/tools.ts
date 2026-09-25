/** Registry of every conversion tool shown on the home page.
 *  Must stay in sync with backend/api/routes/tools.py (TOOLS dict). */

export type ToolOption =
  | {
      kind: "select"
      name: string
      label: string
      choices: { value: string; label: string }[]
      default: string
      /** Hide a choice when every uploaded file already has that extension. */
      excludeUploadedExtension?: boolean
    }
  | { kind: "text"; name: string; label: string; placeholder: string; required?: boolean }
  | {
      kind: "password"
      name: string
      label: string
      placeholder: string
      required?: boolean
      /** Length bounds for a password being SET. Checking an existing one
       *  (Unlock) leaves these off — that PDF's password is whatever it is. */
      minLength?: number
      maxLength?: number
    }

/** The usual bounds for a new password: 8 at the least, and 32 at the most —
 *  kept well inside AES-256 PDF's 127-byte limit even for Korean or Japanese,
 *  which take three bytes a character. The backend enforces the same pair. */
export const NEW_PASSWORD_LENGTH = { minLength: 8, maxLength: 32 } as const

/** Whether a password option's value is outside its length bounds. Empty is
 *  not "too short" — `required` already reports that. */
export function passwordLengthProblem(opt: ToolOption, value: string): "short" | "long" | null {
  if (opt.kind !== "password" || !value) return null
  const length = [...value].length
  if (opt.minLength && length < opt.minLength) return "short"
  if (opt.maxLength && length > opt.maxLength) return "long"
  return null
}

export type Category =
  | "Organize PDF"
  | "Optimize PDF"
  | "Convert PDF"
  | "Edit PDF"
  | "PDF Security"
  | "PDF Intelligence"
  | "Images"

export interface Tool {
  slug: string
  title: string
  description: string
  category: Category
  /** lucide icon name — resolved in tool-card.tsx */
  icon: string
  accept: string
  multiple: boolean
  options?: ToolOption[]
  actionLabel: string
  /** "convert" (default): download a converted file. "ai": show a result panel.
   *  "edit": open the document's text in an editor with export options.
   *  "organize": visual page reorder/delete/rotate manager.
   *  "url": take a URL instead of a file upload.
   *  "sign": draw a signature and place it on a page.
   *  "rotate": page preview that turns with the chosen angle.
   *  "page-numbers": page preview with the number dragged into position.
   *  "translate": AI translation with a language picker, then the doc editor. */
  kind?:
    | "convert"
    | "ai"
    | "edit"
    | "organize"
    | "url"
    | "sign"
    | "translate"
    | "compare"
    | "watermark"
    | "crop"
    | "rotate"
    | "page-numbers"
  /** Show a badge (e.g. "New!") on the home page card. */
  badge?: string
  /** Hint the file input to open the device camera on mobile (Scan to PDF). */
  capture?: boolean
  /** Requires precisely this many files (e.g. Compare PDF needs exactly 2) —
   *  the dropzone stops accepting more once reached, and the run button
   *  stays disabled until the count matches exactly. */
  exactFiles?: number
}

/** Document types the AI tools can read. */
const AI_ACCEPT = ".pdf,.docx,.doc,.odt,.rtf,.txt,.md,.log,.pptx,.ppt,.odp,.xlsx,.xls,.ods,.csv"
/** The document editor reads everything the AI tools do, plus Hancom HWP and
 *  macro-enabled workbooks (it opens a spreadsheet as a real cell grid, so
 *  .xlsm is no different to it from .xlsx — only the macros are dropped). */
const EDIT_ACCEPT = `${AI_ACCEPT},.xlsm,.hwp,.hwpx`
/** What the document-wide tools take: any document the editor reads. The
 *  backend renders non-PDFs to PDF first (core/documents.py), so the result is
 *  always a PDF. Tools about the PDF file itself — Compress, Repair, OCR and
 *  the PDF-to-Office converters — stay on `.pdf`. */
const DOCUMENT_ACCEPT = EDIT_ACCEPT
/** Unlock keeps the file's own format, so it takes only what the backend can
 *  really decrypt: PDF and Microsoft Office (documents.UNLOCKABLE_EXTS). Hancom
 *  and OpenDocument passwords have no decryption library to call. */
const UNLOCK_ACCEPT = ".pdf,.docx,.doc,.xlsx,.xlsm,.xls,.pptx,.ppt"

export const TOOLS: Tool[] = [
  // ------------------------------------------------------------ Organize PDF
  {
    slug: "merge-pdf",
    title: "Merge Documents",
    description: "Combine PDFs, Word, PowerPoint, Excel, HWP and other documents into one PDF, in the order you choose.",
    category: "Organize PDF",
    icon: "Combine",
    accept: DOCUMENT_ACCEPT,
    multiple: true,
    actionLabel: "Merge documents",
  },
  {
    slug: "split-pdf",
    title: "Split Document",
    description: "Extract pages or page ranges from any document into separate PDF files.",
    category: "Organize PDF",
    icon: "Scissors",
    accept: DOCUMENT_ACCEPT,
    multiple: false,
    options: [
      {
        kind: "text",
        name: "ranges",
        label: "Page ranges",
        placeholder: "e.g. 1-3,5,7-9 — leave empty for one file per page",
      },
    ],
    actionLabel: "Split document",
  },
  {
    slug: "compress-pdf",
    title: "Compress PDF",
    description: "Shrink file size while keeping the best possible quality.",
    category: "Organize PDF",
    icon: "FileArchive",
    accept: ".pdf",
    multiple: false,
    options: [
      {
        kind: "select",
        name: "level",
        label: "Compression level",
        choices: [
          { value: "low", label: "Low — best quality" },
          { value: "medium", label: "Recommended — good quality" },
          { value: "high", label: "Extreme — smallest size" },
        ],
        default: "medium",
      },
    ],
    actionLabel: "Compress PDF",
  },
  {
    slug: "rotate-pdf",
    title: "Rotate Document",
    description: "Rotate every page of a document by 90, 180 or 270 degrees and save it as a PDF.",
    category: "Organize PDF",
    icon: "RotateCw",
    accept: DOCUMENT_ACCEPT,
    multiple: false,
    kind: "rotate",
    options: [
      {
        kind: "select",
        name: "angle",
        label: "Rotation",
        choices: [
          { value: "90", label: "90° clockwise" },
          { value: "180", label: "180°" },
          { value: "270", label: "90° counter-clockwise" },
        ],
        default: "90",
      },
    ],
    actionLabel: "Rotate document",
  },
  {
    slug: "organize-pdf",
    title: "Organize Document",
    description: "Reorder, rotate or delete the pages of any document with a visual page-by-page editor.",
    category: "Organize PDF",
    icon: "LayoutGrid",
    accept: DOCUMENT_ACCEPT,
    multiple: false,
    kind: "organize",
    actionLabel: "Organize pages",
  },
  // ----------------------------------------------------------- Optimize PDF
  {
    slug: "repair-pdf",
    title: "Repair PDF",
    description: "Fix a damaged or corrupted PDF and recover as much data as possible.",
    category: "Optimize PDF",
    icon: "Wrench",
    accept: ".pdf",
    multiple: false,
    actionLabel: "Repair PDF",
  },
  {
    slug: "pdf-to-pdfa",
    title: "Document to PDF/A",
    description: "Turn any document into a PDF/A file for long-term archiving, with PDF/A metadata and an ICC profile.",
    category: "Optimize PDF",
    icon: "Archive",
    accept: DOCUMENT_ACCEPT,
    multiple: false,
    actionLabel: "Convert to PDF/A",
  },
  {
    slug: "ocr-pdf",
    title: "OCR PDF",
    description: "Make a scanned PDF searchable and selectable by adding a text layer.",
    category: "Optimize PDF",
    icon: "ScanText",
    accept: ".pdf",
    multiple: false,
    options: [
      {
        kind: "select",
        name: "language",
        label: "Document language",
        choices: [
          { value: "eng", label: "English" },
          { value: "kor", label: "Korean" },
          { value: "chi_sim", label: "Chinese" },
        ],
        default: "eng",
      },
    ],
    actionLabel: "Run OCR",
  },
  // -------------------------------------------------------------- Convert PDF
  {
    slug: "word-to-pdf",
    title: "Word to PDF",
    description: "Convert DOC, DOCX, ODT and RTF documents to PDF.",
    category: "Convert PDF",
    icon: "FileText",
    accept: ".doc,.docx,.odt,.rtf",
    multiple: false,
    actionLabel: "Convert to PDF",
  },
  {
    slug: "powerpoint-to-pdf",
    title: "PowerPoint to PDF",
    description: "Convert PPT, PPTX and ODP presentations to PDF.",
    category: "Convert PDF",
    icon: "Presentation",
    accept: ".ppt,.pptx,.odp",
    multiple: false,
    actionLabel: "Convert to PDF",
  },
  {
    slug: "excel-to-pdf",
    title: "Excel to PDF",
    description: "Convert XLS, XLSX, ODS and CSV spreadsheets to PDF.",
    category: "Convert PDF",
    icon: "Table",
    accept: ".xls,.xlsx,.ods,.csv",
    multiple: false,
    actionLabel: "Convert to PDF",
  },
  {
    slug: "jpg-to-pdf",
    title: "JPG to PDF",
    description: "Turn JPG, PNG, WEBP and other images into a single PDF.",
    category: "Convert PDF",
    icon: "Image",
    accept: ".jpg,.jpeg,.png,.webp,.bmp,.tiff,.gif",
    multiple: true,
    actionLabel: "Convert to PDF",
  },
  {
    slug: "text-to-pdf",
    title: "Text to PDF",
    description: "Convert plain text, Markdown and log files to PDF.",
    category: "Convert PDF",
    icon: "FileType",
    accept: ".txt,.md,.log",
    multiple: false,
    actionLabel: "Convert to PDF",
  },
  {
    slug: "hwp-to-pdf",
    title: "HWP to PDF",
    description: "Convert Hancom Office HWP/HWPX documents to PDF.",
    category: "Convert PDF",
    icon: "FileText",
    accept: ".hwp,.hwpx",
    multiple: false,
    actionLabel: "Convert to PDF",
  },
  {
    slug: "scan-to-pdf",
    title: "Scan to PDF",
    description: "Capture document photos with your camera and turn them into a clean PDF scan.",
    category: "Convert PDF",
    icon: "Camera",
    accept: ".jpg,.jpeg,.png,.webp",
    multiple: true,
    capture: true,
    actionLabel: "Create scan",
  },
  {
    slug: "html-to-pdf",
    title: "HTML to PDF",
    description: "Convert a webpage to PDF. Paste the URL and convert it with a click.",
    category: "Convert PDF",
    icon: "Globe",
    accept: "",
    multiple: false,
    kind: "url",
    actionLabel: "Convert URL to PDF",
  },
  // ------------------------------------------------------ Convert from PDF
  {
    slug: "pdf-to-word",
    title: "PDF to Word",
    description: "Convert PDFs into editable DOCX documents.",
    category: "Convert PDF",
    icon: "FileText",
    accept: ".pdf",
    multiple: false,
    actionLabel: "Convert to Word",
  },
  {
    slug: "pdf-to-powerpoint",
    title: "PDF to PowerPoint",
    description: "Turn each PDF page into a PPTX slide.",
    category: "Convert PDF",
    icon: "Presentation",
    accept: ".pdf",
    multiple: false,
    actionLabel: "Convert to PowerPoint",
  },
  {
    slug: "pdf-to-excel",
    title: "PDF to Excel",
    description: "Extract tables and text from PDFs into XLSX spreadsheets.",
    category: "Convert PDF",
    icon: "Table",
    accept: ".pdf",
    multiple: false,
    actionLabel: "Convert to Excel",
  },
  {
    slug: "pdf-to-jpg",
    title: "Document to JPG",
    description: "Export every page of a document as a high-quality JPG image.",
    category: "Convert PDF",
    icon: "Image",
    accept: DOCUMENT_ACCEPT,
    multiple: false,
    actionLabel: "Convert to JPG",
  },
  {
    slug: "pdf-to-text",
    title: "Document to Text",
    description: "Extract all text from a document into a plain .txt file.",
    category: "Convert PDF",
    icon: "AlignLeft",
    accept: DOCUMENT_ACCEPT,
    multiple: false,
    actionLabel: "Extract Text",
  },
  {
    slug: "pdf-to-markdown",
    title: "Document to Markdown",
    description: "Turn documents into Markdown. Headings, tables, lists and links preserved automatically.",
    category: "Convert PDF",
    icon: "FileCode",
    accept: DOCUMENT_ACCEPT,
    multiple: false,
    actionLabel: "Convert to Markdown",
  },
  {
    slug: "pdf-to-hwp",
    title: "PDF to HWPX",
    description: "Convert PDFs to HWPX, the format Hancom Office / 한글 opens natively.",
    category: "Convert PDF",
    icon: "FileText",
    accept: ".pdf",
    multiple: false,
    actionLabel: "Convert to HWPX",
  },
  // ------------------------------------------------------------ PDF Security
  {
    slug: "protect-pdf",
    title: "Protect Document",
    description: "Add a password to any document. Word, Excel and PowerPoint files (.docx, .xlsx, .pptx) stay in their own format; PDFs stay PDFs; other documents become a password-protected PDF (AES-256).",
    category: "PDF Security",
    icon: "Lock",
    accept: DOCUMENT_ACCEPT,
    multiple: false,
    options: [
      { kind: "password", name: "password", label: "Password", placeholder: "Choose a password", required: true, ...NEW_PASSWORD_LENGTH },
    ],
    actionLabel: "Protect document",
  },
  {
    slug: "unlock-pdf",
    title: "Unlock Document",
    description: "Remove the password from a PDF, Word, Excel or PowerPoint file you own. You get the same file back, unlocked.",
    category: "PDF Security",
    icon: "Unlock",
    accept: UNLOCK_ACCEPT,
    multiple: false,
    options: [
      { kind: "password", name: "password", label: "Current password", placeholder: "Document password", required: true },
    ],
    actionLabel: "Unlock document",
  },
  {
    slug: "redact-pdf",
    title: "Redact Document",
    description: "Permanently remove sensitive text from a document — search a phrase and black it out. Saved as a PDF.",
    category: "PDF Security",
    icon: "EyeOff",
    accept: DOCUMENT_ACCEPT,
    multiple: false,
    options: [
      { kind: "text", name: "term", label: "Text to redact", placeholder: "e.g. Social Security Number", required: true },
    ],
    actionLabel: "Redact document",
  },
  // ---------------------------------------------------------------- Edit PDF
  {
    slug: "edit-document",
    title: "Edit Document",
    description: "Open any document, edit its text right here, and download it as PDF, Word or text.",
    category: "Edit PDF",
    icon: "Pencil",
    accept: EDIT_ACCEPT,
    multiple: false,
    kind: "edit",
    actionLabel: "Open in editor",
  },
  {
    slug: "watermark-pdf",
    title: "Watermark",
    description: "Stamp text over your document. Choose the position, color and transparency.",
    category: "Edit PDF",
    icon: "Droplets",
    accept: DOCUMENT_ACCEPT,
    multiple: false,
    kind: "watermark",
    actionLabel: "Add watermark",
  },
  {
    slug: "page-numbers-pdf",
    title: "Page numbers",
    description: "Add page numbers to your document. Choose the position and starting number.",
    category: "Edit PDF",
    icon: "Hash",
    accept: DOCUMENT_ACCEPT,
    multiple: false,
    kind: "page-numbers",
    options: [
      {
        kind: "select",
        name: "position",
        label: "Position",
        choices: [
          { value: "bottom-center", label: "Bottom center" },
          { value: "bottom-right", label: "Bottom right" },
          { value: "bottom-left", label: "Bottom left" },
          { value: "top-center", label: "Top center" },
          { value: "top-right", label: "Top right" },
          { value: "top-left", label: "Top left" },
        ],
        default: "bottom-center",
      },
      { kind: "text", name: "start", label: "Start at", placeholder: "1" },
    ],
    actionLabel: "Add page numbers",
  },
  {
    slug: "crop-pdf",
    title: "Crop Document",
    description: "Crop the margins of your document's pages by an exact amount.",
    category: "Edit PDF",
    icon: "Crop",
    accept: DOCUMENT_ACCEPT,
    multiple: false,
    kind: "crop",
    actionLabel: "Crop document",
  },
  {
    slug: "sign-pdf",
    title: "Sign Document",
    description: "Draw your signature and place it anywhere on your document.",
    category: "Edit PDF",
    icon: "PenTool",
    accept: DOCUMENT_ACCEPT,
    multiple: false,
    kind: "sign",
    actionLabel: "Sign document",
  },
  // ----------------------------------------------------------- PDF Intelligence
  {
    slug: "summarize-document",
    title: "AI Summarizer",
    description: "Summarize a document or ask anything about it — every answer can be copied.",
    category: "PDF Intelligence",
    icon: "Sparkles",
    accept: AI_ACCEPT,
    multiple: false,
    kind: "ai",
    options: [
      {
        kind: "select",
        name: "length",
        label: "Summary length",
        choices: [
          { value: "short", label: "Short — a few sentences" },
          { value: "medium", label: "Medium — a paragraph or two" },
          { value: "detailed", label: "Detailed — sections and bullet points" },
        ],
        default: "medium",
      },
    ],
    actionLabel: "Summarize",
  },
  {
    slug: "correct-mistakes",
    title: "Correct Mistakes",
    description: "AI proofreads your document, fixes spelling and grammar, and shows every fix.",
    category: "PDF Intelligence",
    icon: "SpellCheck",
    accept: EDIT_ACCEPT,
    multiple: false,
    kind: "ai",
    actionLabel: "Check & Fix",
  },
  {
    slug: "compare-pdf",
    title: "Compare Documents",
    description: "Show a side-by-side text comparison and spot changes between two document versions.",
    category: "PDF Intelligence",
    icon: "GitCompare",
    accept: DOCUMENT_ACCEPT,
    multiple: true,
    exactFiles: 2,
    kind: "compare",
    actionLabel: "Compare documents",
  },
  {
    slug: "translate-pdf",
    title: "Translate Documents",
    description: "Translate documents with AI, keeping fonts, layout and formatting intact.",
    category: "PDF Intelligence",
    icon: "Languages",
    accept: AI_ACCEPT,
    multiple: false,
    kind: "translate",
    badge: "New!",
    actionLabel: "Translate",
  },
  // ----------------------------------------------------------------- Images
  {
    slug: "image-converter",
    title: "Image Converter",
    description: "Convert images between JPG, PNG, WEBP, BMP, TIFF and GIF.",
    category: "Images",
    icon: "Images",
    accept: ".jpg,.jpeg,.png,.webp,.bmp,.tiff,.gif",
    multiple: true,
    options: [
      {
        kind: "select",
        name: "format",
        label: "Convert to",
        excludeUploadedExtension: true,
        choices: [
          { value: "png", label: "PNG" },
          { value: "jpg", label: "JPG" },
          { value: "webp", label: "WEBP" },
          { value: "bmp", label: "BMP" },
          { value: "tiff", label: "TIFF" },
          { value: "gif", label: "GIF" },
        ],
        default: "png",
      },
    ],
    actionLabel: "Convert Images",
  },
  {
    slug: "image-to-text",
    title: "Image to Text",
    description: "Turn photos, scans and images (JPEG, PNG, HEIC) into text. Download as plain text (TXT) or a searchable PDF that keeps the original image.",
    category: "Images",
    icon: "ScanText",
    accept: ".jpg,.jpeg,.png,.webp,.bmp,.tiff,.gif,.heic,.heif",
    multiple: true,
    badge: "New!",
    options: [
      {
        kind: "select",
        name: "format",
        label: "Download as",
        choices: [
          { value: "pdf", label: "PDF (.pdf)" },
          { value: "txt", label: "Text (.txt)" },
        ],
        default: "pdf",
      },
      {
        kind: "select",
        name: "language",
        label: "Document language",
        choices: [
          { value: "eng", label: "English" },
          { value: "kor", label: "Korean" },
          { value: "chi_sim", label: "Chinese" },
        ],
        default: "eng",
      },
    ],
    actionLabel: "Extract text",
  },
]

export const CATEGORIES: Category[] = [
  "Organize PDF",
  "Optimize PDF",
  "Convert PDF",
  "Edit PDF",
  "PDF Security",
  "PDF Intelligence",
  "Images",
]

/**
 * The URL form of a category.
 *
 * The route used to carry the category's display name, so the address bar read
 * `Organize%20PDF` — an escape sequence in the middle of a URL a user is
 * expected to read and share. These are stable lowercase identifiers instead.
 *
 * Separating them is not only cosmetic: a display name is a label, and labels
 * are translated. Keying a URL to one means the link either breaks or silently
 * carries English through a Korean session. A slug is neither.
 */
export const CATEGORY_SLUG: Record<Category, string> = {
  "Organize PDF": "organize",
  "Optimize PDF": "optimize",
  "Convert PDF": "convert",
  "Edit PDF": "edit",
  "PDF Security": "security",
  "PDF Intelligence": "intelligence",
  Images: "images",
}

const BY_SLUG: Record<string, Category> = Object.fromEntries(
  (Object.entries(CATEGORY_SLUG) as [Category, string][]).map(([name, slug]) => [slug, name]),
)

/** Resolve the `<slug>` of `/category/<slug>`, or null if it names nothing.
 *
 *  Accepts the old display-name form too — links shared or bookmarked before
 *  the slugs existed keep working rather than landing on an empty grid. */
export function categoryFromParam(value: string | null | undefined): Category | null {
  if (!value) return null
  const slug = value.trim().toLowerCase()
  if (BY_SLUG[slug]) return BY_SLUG[slug]
  const legacy = CATEGORIES.find((c) => c.toLowerCase() === value.trim().toLowerCase())
  return legacy ?? null
}

/**
 * What each tool produces, for the `PDF -> DOCX` pair in the page header.
 *
 * Only tools whose output format differs from their input and is a single
 * nameable thing. Deliberately omitted:
 *   - PDF-in/PDF-out tools (compress, rotate, merge, protect, watermark…),
 *     where the chip would just say PDF twice;
 *   - tools whose output is chosen by an option (`image-converter`,
 *     `image-to-text`), where the select already says it.
 */
/** The URLs a tool is opened at.
 *
 *  Paths, never query strings — and that is the whole rule for in-app
 *  navigation in this app.
 *
 *  Palette OS renders an app window as `<PluginApp pluginPath={subRoute}>`,
 *  where `subRoute` is whatever `platform.navigate()` was handed minus the
 *  `/apps/<id>` prefix, and turns it back into a route with
 *  `subRoute.split("/").filter(Boolean).map(encodeURIComponent).join("/")`.
 *  A path round-trips through that untouched. A query string does not: the OS
 *  hands the plugin `/apps/<id>?tool=merge-pdf`, the prefix is stripped to
 *  `?tool=merge-pdf`, and the whole query becomes ONE percent-encoded path
 *  segment — `/%3Ftool%3Dmerge-pdf` — which matches no route, so the router
 *  falls through to the app's own not-found ("Tool not found"). The window
 *  never touches `window.location` either, so the value is lost as well as
 *  the route. A reload re-enters through the real URL and works, which is
 *  exactly the click-fails / refresh-works asymmetry this app was reported to
 *  have. */
export const toolHref = (slug: string) => `/tools/${slug}`

/** A tool opened with a Data Room file already selected.
 *
 *  A path segment rather than `?dataRoomFile=<id>`, for the reason above: a
 *  query string on ANY route, even a correct one, collapses into the last
 *  segment and breaks it. */
export const toolFileHref = (slug: string, fileId: number) =>
  `/tools/${slug}/file/${fileId}`

/** What a tool accepts, as short format names rather than an `accept`
 *  attribute. `.jpg,.jpeg,.png` collapses to JPG + PNG — a user does not need
 *  to be told about two spellings of the same thing.
 *
 *  Lived in `transformation-chips.tsx` until that component was removed from
 *  the tool header; it is a pure function over the registry's own `accept`
 *  string, so it belongs beside the registry rather than in a component file. */
export function acceptedFormats(accept: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of accept.split(",")) {
    const ext = raw.trim().replace(/^\./, "").toUpperCase()
    if (!ext) continue
    const label = ext === "JPEG" ? "JPG" : ext === "HTM" ? "HTML" : ext === "HWPX" ? "HWP" : ext
    if (seen.has(label)) continue
    seen.add(label)
    out.push(label)
  }
  return out
}

/**
 * A tool's (or a section's) accepted formats, capped.
 *
 * Twenty format names is not information, it is a wall: the Convert PDF
 * section accepts everything its thirteen tools do between them, and the
 * Edit PDF editor alone reads seventeen. Callers render `shown` and, when
 * `more` is non-zero, their own translated "+N more" — the phrasing differs
 * by surface, the cap does not.
 */
export function formatSummary(accept: string, max = 8): { shown: string; more: number } {
  const formats = acceptedFormats(accept)
  if (formats.length <= max) return { shown: formats.join(" · "), more: 0 }
  return { shown: formats.slice(0, max).join(" · "), more: formats.length - max }
}

export const OUTPUT_FORMAT: Record<string, string | undefined> = {
  "pdf-to-word": "DOCX",
  "pdf-to-powerpoint": "PPTX",
  "pdf-to-excel": "XLSX",
  "pdf-to-jpg": "JPG",
  "pdf-to-text": "TXT",
  "pdf-to-markdown": "MD",
  "pdf-to-hwp": "HWP",
  "pdf-to-pdfa": "PDF/A",
  "word-to-pdf": "PDF",
  "powerpoint-to-pdf": "PDF",
  "excel-to-pdf": "PDF",
  "jpg-to-pdf": "PDF",
  "text-to-pdf": "PDF",
  "hwp-to-pdf": "PDF",
  "scan-to-pdf": "PDF",
  "html-to-pdf": "PDF",
}

export function getTool(slug: string): Tool | undefined {
  return TOOLS.find((t) => t.slug === slug)
}

// ---------------------------------------------------------------- Sections
//
// A category page is a workspace, not a list: one upload at the top, every
// tool in the section beside it, and no re-upload to move between them. These
// are the registry questions that screen asks.

/** Every tool in a section, in registry order. */
export function toolsInCategory(category: Category): Tool[] {
  return TOOLS.filter((t) => t.category === category)
}

/**
 * What a section's dropzone accepts: the union of its tools' `accept` strings.
 *
 * Deliberately the union and not the intersection. "Convert PDF" holds both
 * `word-to-pdf` (.docx) and `pdf-to-word` (.pdf) — an intersection is empty
 * there, and would refuse every file the section exists to handle. The file is
 * taken first and each tool then says whether it can use it; see `toolFit`.
 */
export function categoryAccept(category: Category): string {
  const seen = new Set<string>()
  for (const tool of toolsInCategory(category)) {
    for (const raw of tool.accept.split(",")) {
      const ext = raw.trim().toLowerCase()
      if (ext) seen.add(ext)
    }
  }
  return [...seen].join(",")
}

/** Whether a section's dropzone should take more than one file — true as soon
 *  as ONE of its tools does (Merge PDF, say), with the per-tool limits left to
 *  `toolFit` rather than enforced on the way in. */
export function categoryMultiple(category: Category): boolean {
  return toolsInCategory(category).some((t) => t.multiple)
}

/**
 * Whether a tool can run on the files in hand, and if not, why.
 *
 * The reason is returned as data rather than a sentence: the section screen
 * puts it under a greyed-out tool, and that text is translated at the call
 * site like every other label in the app.
 */
export type ToolFit =
  | { ok: true }
  /** Wrong type — the tool reads `formats` and nothing else. */
  | { ok: false; reason: "format"; formats: string[] }
  /** One at a time, and more than one file is loaded. */
  | { ok: false; reason: "single" }
  /** Holds at most `need` files (Compare PDF), and more are loaded. */
  | { ok: false; reason: "exact"; need: number }

/**
 * Whether a tool works on the section's carried upload.
 *
 * Only `html-to-pdf` does not: its input is a web address, so it stays
 * selectable whatever the dropzone holds. `compare-pdf` does use them — it
 * takes the first two.
 */
export function usesSectionFile(tool: Tool): boolean {
  return tool.kind !== "url"
}

/** Takes anything with a `name`, so a Data Room selection (which is a name and
 *  an id, never a `File`) is checked exactly like an upload. */
export function toolFit(tool: Tool, files: { name: string }[]): ToolFit {
  // Brings its own input, so the uploaded file is beside the point.
  if (!usesSectionFile(tool)) return { ok: true }
  // Nothing uploaded yet: every tool is still open, and the panel asks for the
  // file rather than the rail refusing in advance.
  if (files.length === 0) return { ok: true }

  const allowed = tool.accept
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  const typeOk = files.every((f) => allowed.some((ext) => f.name.toLowerCase().endsWith(ext)))
  if (!typeOk) return { ok: false, reason: "format", formats: acceptedFormats(tool.accept) }

  // Only too MANY is a mismatch. Compare PDF wants two files and will not run
  // until it has both, but one is a perfectly good start — it opens on the
  // left while you find the other, and the run button states what is missing.
  if (tool.exactFiles && files.length > tool.exactFiles) {
    return { ok: false, reason: "exact", need: tool.exactFiles }
  }
  if (!tool.multiple && files.length > 1) return { ok: false, reason: "single" }
  return { ok: true }
}
