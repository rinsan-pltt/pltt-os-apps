/** Curated multi-tool chains: upload once, each step's output feeds the
 *  next automatically. Pure frontend orchestration — every step is just a
 *  normal call to POST /api/tools/{slug}, chained client-side. Only tools
 *  that return exactly one file (never a zip) are chainable. */

import { getTool, TOOLS, type Tool, type ToolOption } from "./tools"

export interface WorkflowStep {
  toolSlug: string
  label: string
  /** Fixed options always sent for this step. */
  options?: Record<string, string>
  /** Options collected from the user before running (e.g. a password). */
  promptOptions?: ToolOption[]
}

export interface Workflow {
  slug: string
  title: string
  description: string
  icon: string
  color: string
  steps: WorkflowStep[]
}

export const WORKFLOWS: Workflow[] = [
  {
    slug: "scan-and-ocr",
    title: "Scan & Make Searchable",
    description: "Turn camera photos of a document into one clean, searchable PDF.",
    icon: "ScanText",
    color: "bg-teal-100 text-teal-600 dark:bg-teal-950 dark:text-teal-400",
    steps: [
      { toolSlug: "scan-to-pdf", label: "Creating scan" },
      { toolSlug: "ocr-pdf", label: "Running OCR", options: { language: "eng" } },
    ],
  },
  {
    slug: "merge-and-compress",
    title: "Merge & Compress",
    description: "Combine multiple PDFs into one document, then shrink the file size.",
    icon: "FileArchive",
    color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400",
    steps: [
      { toolSlug: "merge-pdf", label: "Merging PDFs" },
      { toolSlug: "compress-pdf", label: "Compressing", options: { level: "medium" } },
    ],
  },
  {
    slug: "unlock-and-word",
    title: "Unlock & Convert to Word",
    description: "Remove a PDF's password, then convert it to an editable Word document.",
    icon: "Unlock",
    color: "bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-400",
    steps: [
      {
        toolSlug: "unlock-pdf",
        label: "Unlocking",
        promptOptions: [
          { kind: "password", name: "password", label: "Current PDF password", placeholder: "PDF password", required: true },
        ],
      },
      { toolSlug: "pdf-to-word", label: "Converting to Word" },
    ],
  },
  {
    slug: "compress-and-protect",
    title: "Compress & Protect",
    description: "Shrink your PDF's file size, then lock it with a new password.",
    icon: "Lock",
    color: "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400",
    steps: [
      { toolSlug: "compress-pdf", label: "Compressing", options: { level: "medium" } },
      {
        toolSlug: "protect-pdf",
        label: "Adding password",
        promptOptions: [
          { kind: "password", name: "password", label: "New password", placeholder: "Choose a password", required: true },
        ],
      },
    ],
  },
  {
    slug: "images-to-compressed-pdf",
    title: "Images to Compressed PDF",
    description: "Turn photos or scans into a single, size-optimized PDF.",
    icon: "Image",
    color: "bg-yellow-100 text-yellow-600 dark:bg-yellow-950 dark:text-yellow-400",
    steps: [
      { toolSlug: "jpg-to-pdf", label: "Combining images" },
      { toolSlug: "compress-pdf", label: "Compressing", options: { level: "medium" } },
    ],
  },
  {
    slug: "repair-and-compress",
    title: "Repair & Compress",
    description: "Fix a damaged PDF, then shrink it for easy sharing.",
    icon: "Wrench",
    color: "bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400",
    steps: [
      { toolSlug: "repair-pdf", label: "Repairing" },
      { toolSlug: "compress-pdf", label: "Compressing", options: { level: "medium" } },
    ],
  },
]

/** The first step's tool decides what the workflow accepts as input. */
export function firstTool(workflow: Workflow): Tool | undefined {
  return getTool(workflow.steps[0].toolSlug)
}

// --------------------------------------------------------- User workflows
// No backend "workflow" concept exists — user-created workflows and
// deletions of the built-ins above are both stored client-side.

const CUSTOM_KEY = "file-convertor:custom-workflows"
const HIDDEN_KEY = "file-convertor:hidden-workflows"

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(key, JSON.stringify(value))
}

export function loadCustomWorkflows(): Workflow[] {
  return readJSON<Workflow[]>(CUSTOM_KEY, [])
}

function saveCustomWorkflows(list: Workflow[]) {
  writeJSON(CUSTOM_KEY, list)
}

function loadHiddenSlugs(): string[] {
  return readJSON<string[]>(HIDDEN_KEY, [])
}

function saveHiddenSlugs(list: string[]) {
  writeJSON(HIDDEN_KEY, list)
}

export function isCustomWorkflow(slug: string): boolean {
  return loadCustomWorkflows().some((w) => w.slug === slug)
}

/** Built-in workflows the user has deleted, plus any they've created — the
 *  list every page should render instead of the raw `WORKFLOWS` constant. */
export function listWorkflows(): Workflow[] {
  const hidden = new Set(loadHiddenSlugs())
  return [...WORKFLOWS.filter((w) => !hidden.has(w.slug)), ...loadCustomWorkflows()]
}

/** The URLs the app navigates to for a workflow.
 *
 *  Paths, not query params — see the note on `toolHref` in lib/tools.ts: a
 *  query string collapses into a single percent-encoded path segment when
 *  Palette OS hands a click back to the plugin, and the route stops matching.
 *  Path segments round-trip through the OS untouched, at any depth. */
export const workflowHref = (slug: string) => `/workflows/${slug}`
export const NEW_WORKFLOW_HREF = "/workflows/new"

export function getWorkflow(slug: string): Workflow | undefined {
  const custom = loadCustomWorkflows().find((w) => w.slug === slug)
  if (custom) return custom
  if (loadHiddenSlugs().includes(slug)) return undefined
  return WORKFLOWS.find((w) => w.slug === slug)
}

/** "Delete" a workflow — removed outright if it's user-created, otherwise
 *  hidden, since the 6 built-ins are static data, not rows in a database. */
export function deleteWorkflow(slug: string) {
  if (isCustomWorkflow(slug)) {
    saveCustomWorkflows(loadCustomWorkflows().filter((w) => w.slug !== slug))
    return
  }
  const hidden = loadHiddenSlugs()
  if (!hidden.includes(slug)) saveHiddenSlugs([...hidden, slug])
}

// Tools whose result isn't a single plain file can't be a step in a chain:
// "ai"/"edit"/"organize"/"url"/"sign"/"translate" tools return something
// other than a downloadable blob, and these specific slugs return a zip of
// multiple files rather than one file the next step could consume.
const NON_CHAINABLE_KINDS = new Set(["ai", "edit", "organize", "url", "sign", "translate", "watermark", "crop"])
const NON_CHAINABLE_SLUGS = new Set(["compare-pdf", "split-pdf", "pdf-to-jpg", "image-converter"])

/** Tools a user can pick when building a custom workflow. */
export function chainableTools(): Tool[] {
  return TOOLS.filter((t) => !NON_CHAINABLE_KINDS.has(t.kind ?? "") && !NON_CHAINABLE_SLUGS.has(t.slug))
}

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workflow"
}

function uniqueSlug(base: string): string {
  const taken = new Set([...WORKFLOWS.map((w) => w.slug), ...loadCustomWorkflows().map((w) => w.slug)])
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

/** Build and persist a workflow chaining `toolSlugs` in order. Each step's
 *  options are asked for at run time (same prompt UI as a password step)
 *  rather than fixed at creation time, keeping the builder itself simple. */
export function createWorkflow(title: string, toolSlugs: string[]): Workflow {
  const steps: WorkflowStep[] = toolSlugs.map((toolSlug) => {
    const tool = getTool(toolSlug)
    return {
      toolSlug,
      label: tool?.title ?? toolSlug,
      promptOptions: tool?.options,
    }
  })
  const defaultTitle = steps.map((s) => s.label).join(" & ")
  const resolvedTitle = title.trim() || defaultTitle || "Custom workflow"
  const workflow: Workflow = {
    slug: uniqueSlug(slugify(resolvedTitle)),
    title: resolvedTitle,
    description: steps.map((s) => s.label).join(" → "),
    icon: "Wrench",
    color: "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400",
    steps,
  }
  saveCustomWorkflows([...loadCustomWorkflows(), workflow])
  return workflow
}
