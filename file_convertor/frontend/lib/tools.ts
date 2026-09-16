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
  | { kind: "password"; name: string; label: string; placeholder: string; required?: boolean }

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
   *  "translate": AI translation with a language picker, then the doc editor. */
  kind?: "convert" | "ai" | "edit" | "organize" | "url" | "sign" | "translate" | "compare" | "watermark" | "crop"
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
/** The document editor reads everything the AI tools do, plus Hancom HWP. */
const EDIT_ACCEPT = `${AI_ACCEPT},.hwp,.hwpx`

export const TOOLS: Tool[] = [
  // ------------------------------------------------------------ Organize PDF
  {
    slug: "merge-pdf",
    title: "Merge PDF",
    description: "Combine multiple PDFs into one document, in the order you choose.",
    category: "Organize PDF",
    icon: "Combine",
    accept: ".pdf",
    multiple: true,
    actionLabel: "Merge PDFs",
  },
  {
    slug: "split-pdf",
    title: "Split PDF",
    description: "Extract pages or page ranges into separate PDF files.",
    category: "Organize PDF",
    icon: "Scissors",
    accept: ".pdf",
    multiple: false,
    options: [
      {
        kind: "text",
        name: "ranges",
        label: "Page ranges",
        placeholder: "e.g. 1-3,5,7-9 — leave empty for one file per page",
      },
    ],
    actionLabel: "Split PDF",
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
    title: "Rotate PDF",
    description: "Rotate all pages by 90, 180 or 270 degrees.",
    category: "Organize PDF",
    icon: "RotateCw",
    accept: ".pdf",
    multiple: false,
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
    actionLabel: "Rotate PDF",
  },
  {
    slug: "organize-pdf",
    title: "Organize PDF",
    description: "Reorder, rotate or delete pages with a visual page-by-page editor.",
    category: "Organize PDF",
    icon: "LayoutGrid",
    accept: ".pdf",
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
    title: "PDF to PDF/A",
    description: "Tag your PDF for long-term archiving with PDF/A metadata and an ICC profile.",
    category: "Optimize PDF",
    icon: "Archive",
    accept: ".pdf",
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
    title: "PDF to JPG",
    description: "Export every PDF page as a high-quality JPG image.",
    category: "Convert PDF",
    icon: "Image",
    accept: ".pdf",
    multiple: false,
    actionLabel: "Convert to JPG",
  },
  {
    slug: "pdf-to-text",
    title: "PDF to Text",
    description: "Extract all text from a PDF into a plain .txt file.",
    category: "Convert PDF",
    icon: "AlignLeft",
    accept: ".pdf",
    multiple: false,
    actionLabel: "Extract Text",
  },
  {
    slug: "pdf-to-markdown",
    title: "PDF to Markdown",
    description: "Turn PDFs into Markdown. Headings, tables, lists and links preserved automatically.",
    category: "Convert PDF",
    icon: "FileCode",
    accept: ".pdf",
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
    title: "Protect PDF",
    description: "Encrypt your PDF with a password (AES-256).",
    category: "PDF Security",
    icon: "Lock",
    accept: ".pdf",
    multiple: false,
    options: [
      { kind: "password", name: "password", label: "Password", placeholder: "Choose a password", required: true },
    ],
    actionLabel: "Protect PDF",
  },
  {
    slug: "unlock-pdf",
    title: "Unlock PDF",
    description: "Remove a password from a PDF you own.",
    category: "PDF Security",
    icon: "Unlock",
    accept: ".pdf",
    multiple: false,
    options: [
      { kind: "password", name: "password", label: "Current password", placeholder: "PDF password", required: true },
    ],
    actionLabel: "Unlock PDF",
  },
  {
    slug: "redact-pdf",
    title: "Redact PDF",
    description: "Permanently remove sensitive text from a PDF — search a phrase and black it out.",
    category: "PDF Security",
    icon: "EyeOff",
    accept: ".pdf",
    multiple: false,
    options: [
      { kind: "text", name: "term", label: "Text to redact", placeholder: "e.g. Social Security Number", required: true },
    ],
    actionLabel: "Redact PDF",
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
    description: "Stamp text over your PDF. Choose the position, color and transparency.",
    category: "Edit PDF",
    icon: "Droplets",
    accept: ".pdf",
    multiple: false,
    kind: "watermark",
    actionLabel: "Add watermark",
  },
  {
    slug: "page-numbers-pdf",
    title: "Page numbers",
    description: "Add page numbers to your PDF. Choose the position and starting number.",
    category: "Edit PDF",
    icon: "Hash",
    accept: ".pdf",
    multiple: false,
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
    title: "Crop PDF",
    description: "Crop the margins of your PDF pages by an exact amount.",
    category: "Edit PDF",
    icon: "Crop",
    accept: ".pdf",
    multiple: false,
    kind: "crop",
    actionLabel: "Crop PDF",
  },
  {
    slug: "sign-pdf",
    title: "Sign PDF",
    description: "Draw your signature and place it anywhere on your PDF.",
    category: "Edit PDF",
    icon: "PenTool",
    accept: ".pdf",
    multiple: false,
    kind: "sign",
    actionLabel: "Sign PDF",
  },
  // ----------------------------------------------------------- PDF Intelligence
  {
    slug: "summarize-document",
    title: "AI Summarizer",
    description: "Quickly generate concise summaries from any document, with clear, precise key points.",
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
    accept: AI_ACCEPT,
    multiple: false,
    kind: "ai",
    actionLabel: "Check & Fix",
  },
  {
    slug: "compare-pdf",
    title: "Compare PDF",
    description: "Show a side-by-side text comparison and spot changes between two PDF versions.",
    category: "PDF Intelligence",
    icon: "GitCompare",
    accept: ".pdf",
    multiple: true,
    exactFiles: 2,
    kind: "compare",
    actionLabel: "Compare PDFs",
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
