/**
 * The global chat's hands: what the model is told it can run, and how each
 * planned step is actually run.
 *
 * The catalog is built from the SAME registry the tool pages use (lib/tools.ts),
 * so the model sees exactly the tools, formats and option values a user can
 * click. Tools whose page sets their options visually (watermark position,
 * crop area, page order) get plain options here that their backend endpoints
 * already accept. Every step then runs through the endpoint the tool page
 * itself calls — nothing is reimplemented for chat.
 */

import {
  askDocument,
  exportEditedHtmlFile,
  openDocumentChat,
  organizeApply,
  proofreadDocument,
  runTool,
  runUrlTool,
  translateDocument,
  type ToolResult,
} from "@/lib/api"
import { pagesToExportHtml } from "@/components/layout/edit-workspace"
import { TOOLS, type Tool, type ToolOption } from "@/lib/tools"

export interface CatalogOption {
  name: string
  kind: string
  choices?: string[]
  required?: boolean
}

export interface CatalogTool {
  slug: string
  title: string
  description: string
  accept: string
  multiple: boolean
  exactFiles?: number
  runnable: boolean
  options: CatalogOption[]
}

/** Options for tools whose page gathers them visually. Names are what the
 *  backend endpoint reads. */
const CHAT_OPTIONS: Record<string, CatalogOption[]> = {
  "watermark-pdf": [
    { name: "text", kind: "text", required: true },
    {
      name: "position",
      kind: "select",
      choices: ["center", "top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"],
    },
    { name: "opacity", kind: "number 5-100" },
    { name: "color", kind: "#RRGGBB" },
  ],
  "crop-pdf": [{ name: "margins", kind: "points to cut: top,right,bottom,left", required: true }],
  "organize-pdf": [
    {
      name: "order",
      kind: "final page list, 1-based, comma-separated; omit a page to delete it; add :90/:180/:270 to rotate one (e.g. 3,1,2:90)",
      required: true,
    },
  ],
  "translate-pdf": [
    { name: "target_language", kind: "language name in English, e.g. Japanese", required: true },
    { name: "format", kind: "select", choices: ["docx", "pdf"] },
  ],
  "summarize-document": [{ name: "question", kind: "the user's question or request about the document", required: true }],
  "html-to-pdf": [{ name: "url", kind: "https:// address", required: true }],
}

/** Tools that need a person at the controls: drawing a signature, editing
 *  text on the page. Chat links to them instead. */
const INTERACTIVE = new Set(["edit-document", "sign-pdf"])

function registryOptions(options: ToolOption[] | undefined): CatalogOption[] {
  return (options ?? []).map((o) => ({
    name: o.name,
    kind: o.kind,
    choices: o.kind === "select" ? o.choices.map((c) => c.value) : undefined,
    required: "required" in o ? o.required : undefined,
  }))
}

export function buildCatalog(): CatalogTool[] {
  return TOOLS.map((tool: Tool) => ({
    slug: tool.slug,
    title: tool.title,
    description: tool.description,
    accept: tool.accept,
    multiple: tool.multiple,
    exactFiles: tool.exactFiles,
    runnable: !INTERACTIVE.has(tool.slug),
    options: CHAT_OPTIONS[tool.slug] ?? registryOptions(tool.options),
  }))
}

export interface StepOutcome {
  /** Files the step produced (converted documents, reports, …). */
  files: ToolResult[]
  /** Text the step produced — a document answer, a fix summary. */
  text?: string
}

const stem = (name: string) => name.replace(/\.[^.]+$/, "")
const extOf = (name: string) => (name.split(".").pop() ?? "").toLowerCase()

/**
 * Run one planned step on its input files, through the endpoint that tool's
 * own page uses. Throws with the backend's message on failure.
 */
export async function runStep(
  slug: string,
  inputs: File[],
  options: Record<string, string>,
  labels: { fixes: (n: number) => string },
): Promise<StepOutcome> {
  const tool = TOOLS.find((t) => t.slug === slug)
  if (!tool) throw new Error(`Unknown tool "${slug}".`)
  const first = inputs[0]

  switch (tool.kind) {
    case "url":
      return { files: [await runUrlTool(slug, options.url ?? "")] }
    case "organize":
      return { files: [await organizeApply(first, options.order ?? "")] }
    case "translate": {
      const result = await translateDocument(first, options.target_language || "English")
      const format = options.format === "pdf" ? "pdf" : "docx"
      const lang = (options.target_language || "translated").toLowerCase().replace(/\s+/g, "_")
      return { files: [await exportEditedHtmlFile(result.html, format, `${stem(first.name)}_${lang}`)] }
    }
    case "ai": {
      if (slug === "summarize-document") {
        const doc = await openDocumentChat(first)
        const reply = await askDocument({
          filename: doc.filename,
          text: doc.text,
          history: [],
          prompt: options.question || "Summarize this document.",
        })
        return { files: [], text: reply.answer }
      }
      // Correct Mistakes: fixed inside the original layout, returned in the
      // original format (see backend core/proofread.py).
      const result = await proofreadDocument(first)
      const ext = extOf(first.name)
      const format = ext === "hwp" ? "hwpx" : ext || "pdf"
      const file = await exportEditedHtmlFile(pagesToExportHtml(result.pages), format, `${stem(first.name)}_corrected`)
      const listed = result.fixes
        .filter((f) => f.applied !== false)
        .slice(0, 20)
        .map((f) => `- ${f.before} → ${f.after}`)
        .join("\n")
      return { files: [file], text: [labels.fixes(result.fix_count), listed].filter(Boolean).join("\n") }
    }
    default:
      return { files: [await runTool(slug, inputs, options)] }
  }
}
