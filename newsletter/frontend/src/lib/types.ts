// Shared domain types for the newsletter app. These mirror the backend
// models (models.py) / serialize.py DTO shapes.

export type DocStatus = "uploaded" | "parsing" | "embedding" | "ready" | "error";

export interface DocFacts {
  topic?: string;
  dates?: string[];
  orgs?: string[];
  people?: string[];
}

export interface SourceDocument {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  status: DocStatus;
  error?: string | null;
  summary: string;
  facts?: DocFacts;
  pageCount: number;
  chunkCount: number;
  createdAt: string; // ISO
  /** The original upload. Null when storage handed back a URL the browser
   *  cannot follow (`pltt dev`'s `file://` tier) — see serialize.doc_to_dict. */
  fileUrl?: string | null;
}

/** One stored chunk of a document's extracted text — what retrieval searches.
 *  Consecutive chunks overlap, so they are shown as separate blocks rather than
 *  joined into one body of text. */
/** Geometry of one rendered page, in the pixels the server renders at. Known
 *  before any image arrives, so the viewer can lay out correctly-shaped page
 *  sheets instead of reflowing as they load. */
export interface DocumentPage {
  index: number;
  width: number;
  height: number;
}

/** Whether a document can be shown as its real pages. `kind: "text"` means the
 *  format cannot be rendered (DOCX, PPTX, Markdown, plain text) and only the
 *  extracted text is available. */
export interface DocumentPreview {
  kind: "pages" | "text";
  pages: DocumentPage[];
}

export interface DocumentChunk {
  id: string;
  index: number;
  content: string;
  tokenCount: number;
  embedded: boolean;
}

export type NewsletterStatus = "draft" | "ready";

export type LayoutKey =
  | "title_only"
  | "single_column"
  | "two_column"
  | "hero_image"
  | "feature_split"
  | "sidebar"
  | "gallery"
  | "text_only"
  | "image_right"
  | "six_image_grid"
  | "three_across"
  | "image_trio"
  | "two_image_single_column"
  | "banner_text"
  | "paired_column";

export interface LayoutOption {
  key: LayoutKey;
  label: string;
  hint: string;
}

export interface Citation {
  documentId: string;
  documentName: string;
  chunkId: string;
  snippet: string;
}

export interface NewsletterBlock {
  id: string;
  order: number;
  layout: LayoutKey;
  title: string;
  summary: string;
  content: string;
  imageDesc?: string;
  images?: string[]; // per-slot image URLs
  citations: Citation[];
  /** id of the parent block when this is a continuation (auto-split tail). */
  continuationOf?: string | null;
  /** force this block to start on a new page. */
  forcePageBreak?: boolean;
  /** keep this block on the same page as the next one (orphan control). */
  keepNext?: boolean;
}

export interface ColorScheme {
  name: string;
  bg: string;
  title: string;
  body: string;
  accent: string;
}

export interface NewsletterLayout {
  pageSize?: string;
  brandName?: string;
  tagline?: string;
  footerText?: string;
  showPageNumbers?: boolean;
}

export interface Palette {
  bg: string;
  title: string;
  body: string;
  accent: string;
  highlights?: string[]; // per-theme highlight swatches (length 4); falls back to DEFAULT_HIGHLIGHTS
}

export interface Typography {
  fontFamily: string;
  scale: number;
}

export type TemplateRule = "first" | "subsequent" | "odd" | "even" | "all";

export type BrandElementType = "logo" | "text" | "divider" | "box" | "image";

export interface BrandElement {
  id: string;
  type: BrandElementType;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  rotation?: number;
  text?: string; // text element (may contain {{ vars }})
  literal?: boolean; // true once user-edited: render text verbatim, no Jinja
  fontSize?: number;
  color?: string; // hex, or token: accent|title|body|bg
  bold?: boolean;
  align?: "left" | "center" | "right";
  thickness?: number; // divider
  // box / shape
  bgColor?: string;
  borderColor?: string;
  borderWidth?: number;
  radius?: number;
  imageUrl?: string; // image element
}

export interface BrandTemplate {
  id: string;
  name: string;
  rule: TemplateRule;
  height: number; // band height (px on page)
  elements: BrandElement[];
  html?: string; // legacy raw-Jinja fallback
}

export interface Brand {
  id: string;
  name: string;
  logoUrl: string | null;
}

export interface BrandTheme {
  id: string;
  name: string;
  palette: Palette;
  typography: Typography;
  headers: BrandTemplate[];
  footers: BrandTemplate[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// Full copy of a BrandTheme captured onto a newsletter at pick time — stays
// self-contained even if the source theme is later edited or deleted.
export interface ThemeSnapshot {
  themeId: string | null;
  themeName: string;
  palette: Palette;
  typography: Typography;
  headers: BrandTemplate[];
  footers: BrandTemplate[];
}

export interface RenderedElement {
  id: string;
  type: BrandElementType;
  editable: boolean;
  boxStyle: string; // css string for the positioned wrapper (display render)
  html: string; // rendered inner content (display render)
  xPct: number;
  yPct: number;
  wPct: number;
  hpx: number; // resolved element height in px (band height * hPct/100)
  rotation: number;
  fontSize: number;
  align: "left" | "center" | "right";
  bold: boolean;
  color: string; // resolved hex
  text: string | null; // resolved plain text (editable text elements only)
}

export interface RenderedTemplate {
  id: string;
  name: string;
  rule: TemplateRule;
  html: string;
  height?: number;
  elements?: RenderedElement[];
}

export type OverlayType = "mascot" | "image" | "text" | "line";

export interface Overlay {
  id: string;
  type: OverlayType;
  imageUrl?: string; // mascot / image
  content?: string; // text overlay (HTML)
  color?: string; // text color / line color
  bgColor?: string; // text background
  strokeWidth?: number; // line thickness (px)
  xPct: number;
  yPct: number;
  wPct: number;
  hPct?: number; // height for text / image boxes
  rotation: number;
}

export interface Mascot {
  id: string;
  name: string;
  imageUrl: string;
  createdAt: string;
}

export interface Newsletter {
  id: string;
  title: string;
  status: NewsletterStatus;
  language: string;
  focusPrompt?: string;
  brandThemeId: string | null;
  themeSnapshot: ThemeSnapshot;
  layout: NewsletterLayout;
  sourceDocumentIds: string[];
  overlays: Overlay[];
  blocks: NewsletterBlock[];
  createdAt: string;
  updatedAt: string;
}

// Returned by the RAG retrieval step during generation.
export interface RetrievedChunk {
  documentId: string;
  documentName: string;
  chunkId: string;
  score: number;
  snippet: string;
}

export interface GenerateRequest {
  title: string;
  language: string;
  blockCount: number;
  tone: string;
  focusPrompt: string;
  sourceDocumentIds: string[];
  brandThemeId: string;
}
