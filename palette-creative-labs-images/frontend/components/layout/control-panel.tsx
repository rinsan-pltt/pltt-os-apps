"use client"

import React from "react"
import { createPortal } from "react-dom"
import { IconPlus, IconX, IconArrowsMaximize } from "@tabler/icons-react"
import { createPaletteClient, usePlatform } from "@palettelab/sdk"
import { useRouter, usePathname, useSearchParams } from "@palettelab/sdk/router"
import { apiRequest } from "@/lib/api-helper"
import { uploadReferenceImage } from "@/lib/gcs-upload-helper"
import { toast } from "@/components/ui/sonner"
import { useModelContext } from "@/components/providers/model-context"
import { useProjectContext } from "@/components/providers/project-context"
import { ModelTabsHeader } from "./model-tabs-header"
import { ChatPanel } from "./chat-panel"
import { imageModelOptions } from "./video-helper"
import { cn } from "@/lib/utils"
import { Button } from "../ui/button"
import { useT } from "@/lib/i18n"

type ReferenceValue = string | File | { assetId: string; previewUrl: string }
type ReferenceEntry = { id: string; value: ReferenceValue }

const MAX_REFERENCES = 10
// Custom drag MIME stamped on drags that start from an existing reference
// thumbnail. The references box checks for it (via dataTransfer.types, which is
// readable during dragover) to ignore self-drops instead of duplicating them.
const REFERENCE_DRAG_TYPE = "application/x-pltt-reference"
const COUNT_OPTIONS = ["1", "2", "4"]
const ASPECT_OPTIONS = ["16:9", "1:1", "9:16"]
const RESOLUTION_OPTIONS = ["HD", "2K", "4K"]

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `r_${Math.random().toString(36).slice(2)}_${Date.now()}`

const getPreviewUrl = (value: ReferenceValue): string => {
  if (typeof value === "string") return value
  if (value instanceof File) return URL.createObjectURL(value)
  return value.previewUrl
}

const sanitizeExt = (ext: string): string => {
  const clean = ext.toLowerCase().replace(/[^a-z0-9]/g, "")
  return clean || "png"
}

const getExtensionFromName = (name: string): string => {
  const m = name.match(/\.([^./?#]+)(?:[?#]|$)/)
  return m ? sanitizeExt(m[1]) : "png"
}

const getExtension = (value: ReferenceValue): string => {
  if (value instanceof File) return getExtensionFromName(value.name)
  if (typeof value === "string") return getExtensionFromName(value)
  return getExtensionFromName(value.previewUrl)
}

const ParamGroup = ({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: string[]
  value: string
  onChange: (v: string) => void
}) => (
  <div className="flex-1 flex flex-col gap-2 px-4 py-3 [&:not(:first-child)]:border-l border-border50">
    <span className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">{label}</span>
    <div className="flex items-center">
      {options.map((opt) => (
        <Button
          key={opt}
          onClick={() => onChange(opt)}
          variant={value === opt ? "default" : "outline"}
          size={"xs"}
          className="[&:not(:first-child)]:-ml-px"
        >
          {opt}
        </Button>
      ))}
    </div>
  </div>
)

export const ControlPanel = ({
  editData,
}: {
  onGenerate?: () => void
  editData?: { prompt: string; imageUrl: string } | null
}) => {
  const { t } = useT()
  const { selectedModels, setSelectedModels } = useModelContext()
  const platform = usePlatform()
  const palette = React.useMemo(() => createPaletteClient(platform), [platform])
  const {
    currentProject,
    activeKeyFrameId,
    addOptimisticItems,
    clearOptimisticBatch,
    refreshCurrentProject,
    chatTarget,
    openChatForItem,
    clearChatTarget,
  } = useProjectContext()

  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // PROMPT (existing UI) vs CHAT (new conversational UI). Only the CHAT view is
  // new — PROMPT renders exactly as before. Initial tab comes from `?tab=` so a
  // refresh reopens the tab the user was on.
  const [mode, setMode] = React.useState<"prompt" | "chat">(
    () => (searchParams.get("tab") === "chat" ? "chat" : "prompt"),
  )

  // A genuine Edit click brings the CHAT tab forward. Restoring an edit from
  // the URL also sets chatTarget, but must NOT override the tab the URL asked
  // for (e.g. the user left on PROMPT) — that path sets restoringEditRef first.
  const restoringEditRef = React.useRef(false)
  React.useEffect(() => {
    if (!chatTarget) return
    // A target re-applied because its keyframe became active again keeps
    // whatever tab the user is on — only a genuine Edit click switches.
    if (chatTarget.restored) return
    if (restoringEditRef.current) {
      restoringEditRef.current = false
      return
    }
    setMode("chat")
  }, [chatTarget])

  // chatTarget is app-level and per-project: drop a stale anchor that belongs
  // to a different project (e.g. opening another project from the listing) and
  // fall back to the PROMPT tab.
  React.useEffect(() => {
    const pid = currentProject?.id
    if (!pid || !chatTarget) return
    const targetPid = chatTarget.item.project_id
    if (targetPid && targetPid !== pid) {
      clearChatTarget()
      setMode("prompt")
    }
  }, [chatTarget, currentProject?.id, clearChatTarget])

  // Opening a *different* project starts fresh on the PROMPT tab — a chat/edit
  // anchored in another project shouldn't carry over. The first project seen
  // this mount is left alone so a refresh still restores its tab/edit from the
  // URL (handled below).
  const seenProjectRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    const id = currentProject?.id ?? null
    if (!id) return
    if (seenProjectRef.current === null) {
      seenProjectRef.current = id
      return
    }
    if (seenProjectRef.current !== id) {
      seenProjectRef.current = id
      clearChatTarget()
      setMode("prompt")
    }
  }, [currentProject?.id, clearChatTarget])

  // Restore an in-progress edit from `?edit=<imageId>` on refresh. Until this
  // settles, URL-syncing is paused so it can't strip the param before the
  // project's items have loaded. Starts pending only if the URL has an edit id.
  const [restorePending, setRestorePending] = React.useState(
    () => !!searchParams.get("edit"),
  )
  React.useEffect(() => {
    if (!restorePending) return
    if (chatTarget) {
      setRestorePending(false)
      return
    }
    const editId = searchParams.get("edit")
    if (!editId) {
      setRestorePending(false)
      return
    }
    if (!currentProject) return // wait for the project payload to load
    for (const kf of currentProject.key_frames ?? []) {
      const it = (kf.items ?? []).find((x) => x.id === editId)
      if (it) {
        // Restore the anchor without forcing the tab — keep the URL's `?tab=`.
        restoringEditRef.current = true
        openChatForItem({
          id: it.id,
          url: it.url,
          prompt: it.prompt,
          model_name: it.model_name,
          key_frame_id: kf.id,
          project_id: currentProject.id,
        })
        break
      }
    }
    setRestorePending(false) // settled (anchored, or image no longer exists)
  }, [restorePending, searchParams, currentProject, chatTarget, openChatForItem])

  // Mirror the active tab + edit target into the URL so a refresh restores
  // them. `replace` keeps it out of the back-stack; the guard avoids loops.
  React.useEffect(() => {
    if (restorePending) return // don't clobber `?edit=` before it's restored
    const wantEdit = chatTarget?.item?.id ?? null
    if (searchParams.get("tab") === mode && (searchParams.get("edit") ?? null) === wantEdit) return
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", mode)
    if (wantEdit) params.set("edit", wantEdit)
    else params.delete("edit")
    router.replace(`${pathname}?${params.toString()}`)
  }, [restorePending, mode, chatTarget, pathname, searchParams, router])

  const [aspectRatio, setAspectRatio] = React.useState("1:1")
  const [resolution, setResolution] = React.useState("HD")
  const [numOutputs, setNumOutputs] = React.useState("1")
  const [prompt, setPrompt] = React.useState("")
  const [referenceItems, setReferenceItems] = React.useState<ReferenceEntry[]>([])
  // URL of the reference image currently shown in the large viewer (null = closed).
  const [viewerUrl, setViewerUrl] = React.useState<string | null>(null)
  // The large viewer is portaled out of this panel so the OS plugin-sandbox
  // wrapper (which applies containment to `[data-palette-plugin-root]`) can't
  // re-scope our `position: fixed` overlay or trap its click handling. We mount
  // it on the plugin root so the scoped Tailwind CSS still applies; in the local
  // dev simulator (no plugin root) we fall back to document.body.
  const rootRef = React.useRef<HTMLDivElement>(null)
  const [viewerHost, setViewerHost] = React.useState<HTMLElement | null>(null)
  React.useEffect(() => {
    const host = rootRef.current?.closest("[data-palette-plugin-root]") as HTMLElement | null
    setViewerHost(host ?? document.body)
  }, [])

  // Close the large reference viewer on Escape.
  React.useEffect(() => {
    if (!viewerUrl) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewerUrl(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [viewerUrl])
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const promptRef = React.useRef<HTMLDivElement>(null)
  const lastSelectionRef = React.useRef<Range | null>(null)

  const refsById = React.useMemo(() => {
    const m = new Map<string, { idx: number; entry: ReferenceEntry }>()
    referenceItems.forEach((entry, idx) => m.set(entry.id, { idx, entry }))
    return m
  }, [referenceItems])

  // Extract plain-text prompt with chips serialized as "R{n}"
  const extractPromptText = React.useCallback((): string => {
    const div = promptRef.current
    if (!div) return ""
    let out = ""
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.textContent ?? ""
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      const el = node as HTMLElement
      const refId = el.getAttribute("data-ref-id")
      if (refId !== null) {
        const info = refsById.get(refId)
        if (info) out += `R${info.idx + 1}`
        return
      }
      if (el.tagName === "BR") {
        out += "\n"
        return
      }
      el.childNodes.forEach(walk)
      if (el.tagName === "DIV" || el.tagName === "P") out += "\n"
    }
    div.childNodes.forEach(walk)
    return out.replace(/\n+$/, "")
  }, [refsById])

  // Keep chips in sync with the references pool (remove orphans, re-label)
  React.useEffect(() => {
    const div = promptRef.current
    if (!div) return
    let mutated = false
    div.querySelectorAll<HTMLElement>("[data-ref-id]").forEach((el) => {
      const id = el.getAttribute("data-ref-id")!
      const info = refsById.get(id)
      if (!info) {
        el.remove()
        mutated = true
        return
      }
      const label = el.querySelector<HTMLElement>("[data-ref-label]")
      const desired = `R${info.idx + 1}`
      if (label && label.textContent !== desired) {
        label.textContent = desired
        mutated = true
      }
    })
    setPrompt(extractPromptText())
    void mutated
  }, [refsById, extractPromptText])

  // Populate references from the active keyframe's assets
  React.useEffect(() => {
    const kf = currentProject?.key_frames?.find((k) => k.id === activeKeyFrameId)
    const assets = kf?.assets ?? []
    setReferenceItems(
      assets.map((a) => ({ id: a.id, value: { assetId: a.id, previewUrl: a.url } }))
    )
    // clear chips from prompt editor when keyframe switches
    if (promptRef.current) {
      promptRef.current.querySelectorAll("[data-ref-id]").forEach((el) => el.remove())
    }
  }, [activeKeyFrameId, currentProject])

  // Hydrate from editData (initial mount or when edit target changes)
  React.useEffect(() => {
    if (!editData) return
    const id = makeId()
    setReferenceItems([{ id, value: editData.imageUrl }])
    if (promptRef.current) {
      promptRef.current.textContent = editData.prompt
    }
    setPrompt(editData.prompt)
  }, [editData])

  const saveSelection = () => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && promptRef.current?.contains(sel.anchorNode)) {
      lastSelectionRef.current = sel.getRangeAt(0).cloneRange()
    }
  }

  const restoreSelection = () => {
    const div = promptRef.current
    if (!div) return
    div.focus()
    const sel = window.getSelection()
    if (!sel) return
    if (lastSelectionRef.current) {
      sel.removeAllRanges()
      sel.addRange(lastSelectionRef.current)
    } else {
      const range = document.createRange()
      range.selectNodeContents(div)
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }

  const insertChip = (entry: ReferenceEntry, idx: number) => {
    const div = promptRef.current
    if (!div) return
    restoreSelection()

    const chip = document.createElement("span")
    chip.setAttribute("contenteditable", "false")
    chip.setAttribute("data-ref-id", entry.id)
    chip.className =
      "inline-flex items-center gap-1 px-1 py-0.5 mx-0.5 bg-secondary border border-border60 align-middle select-none"

    const img = document.createElement("img")
    img.src = getPreviewUrl(entry.value)
    img.className = "w-4 h-4 object-cover"
    img.alt = ""

    const label = document.createElement("span")
    label.setAttribute("data-ref-label", "")
    label.className = "text-xs font-semibold tracking-wide"
    label.textContent = `R${idx + 1}`

    chip.appendChild(img)
    chip.appendChild(label)

    const spacer = document.createTextNode(" ")

    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && div.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0)
      range.deleteContents()
      range.insertNode(spacer)
      range.insertNode(chip)
      range.setStartAfter(spacer)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    } else {
      div.appendChild(chip)
      div.appendChild(spacer)
    }

    lastSelectionRef.current = window.getSelection()?.getRangeAt(0).cloneRange() ?? null
    setPrompt(extractPromptText())
  }

  // Serialize the prompt for submission: chips become "R{n}.{ext}"
  const buildSubmitPrompt = (extByIdx: string[]): string => {
    const div = promptRef.current
    if (!div) return ""
    let out = ""
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.textContent ?? ""
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      const el = node as HTMLElement
      const refId = el.getAttribute("data-ref-id")
      if (refId !== null) {
        const info = refsById.get(refId)
        if (info) out += `r${info.idx + 1}.${extByIdx[info.idx] ?? "png"}`
        return
      }
      if (el.tagName === "BR") {
        out += "\n"
        return
      }
      el.childNodes.forEach(walk)
      if (el.tagName === "DIV" || el.tagName === "P") out += "\n"
    }
    div.childNodes.forEach(walk)
    return out.replace(/\n+$/, "")
  }

  const handleGenerate = () => {
    if (!prompt.trim()) return
    if (currentProject && !activeKeyFrameId) {
      toast.error(t("control.selectKeyFrame"))
      return
    }

    // Snapshot every input the background pipeline needs, so the user can
    // edit the prompt / swap references / click Generate again right away
    // without disturbing the in-flight batch.
    const clientBatchId = makeId()
    // Generate the generation_id client-side and send it along with the
    // POST. The backend uses this exact id when creating the items and
    // broadcasting SSE events, so the placeholder we stamp here and the
    // first SSE event share the same id from frame 1 — no race where the
    // SSE "started" event lands before the POST response and both render.
    const genId = makeId()
    const snapPrompt = prompt
    const snapModels = [...selectedModels]
    const snapRefs = [...referenceItems]
    const snapAspect = aspectRatio
    const snapResolution = resolution.toLowerCase()
    const snapNumImages = parseInt(numOutputs) || 1
    const snapKeyFrameId = activeKeyFrameId ?? undefined
    const snapProjectId = currentProject?.id

    // Render "generating" placeholders immediately so the workspace shows
    // progress even before the reference upload + POST roundtrip finishes,
    // and even if SSE never delivers the "started" event.
    const nowIso = new Date().toISOString()
    const placeholders = snapModels.flatMap((model) =>
      Array.from({ length: snapNumImages }, (_, i) => ({
        id: `__opt_${clientBatchId}_${model}_${i}`,
        status: "started" as const,
        model_name: model,
        prompt: snapPrompt,
        project_id: snapProjectId,
        key_frame_id: snapKeyFrameId,
        aspect_ratio: snapAspect,
        resolution: snapResolution,
        created_at: nowIso,
        generation_id: genId,
        _optimistic: true as const,
        _clientBatchId: clientBatchId,
      }))
    )
    const optimisticAdded = placeholders.length > 0
    if (optimisticAdded) addOptimisticItems(placeholders)

    // Scroll the generation workspace to the top so the newly-created batch
    // (sorted newest-first) is immediately in view.
    if (typeof window !== "undefined") {
      const el = document.querySelector<HTMLElement>("[data-generation-scroll]")
      el?.scrollTo({ top: 0, behavior: "smooth" })
    }

    // The button is now free — the user can click Generate again to queue
    // another batch in parallel. Everything below runs detached.
    void (async () => {
      try {
        const extByIdx: string[] = snapRefs.map(({ value }) => getExtension(value))

        // Upload-once-dedupe: every file is uploaded to OS app storage via the
        // SDK storage client (`palette.storage.upload`), then registered by
        // content hash so identical bytes reuse the same {id, url}.
        const uploadedAssets: { entryId: string; assetId: string; previewUrl: string }[] = []
        const resolvedUrls: { id?: string; url: string }[] = await Promise.all(
          snapRefs.map(async ({ id: entryId, value }) => {
            if (typeof value === "string") return { url: value }
            if (value instanceof File) {
              const res = await uploadReferenceImage(palette, value)
              uploadedAssets.push({ entryId, assetId: res.id, previewUrl: res.url })
              return { id: res.id, url: res.url }
            }
            return { id: value.assetId, url: value.previewUrl }
          })
        )

        if (uploadedAssets.length > 0) {
          const patch = new Map(uploadedAssets.map((u) => [u.entryId, u]))
          setReferenceItems((prev) =>
            prev.map((entry) => {
              const u = patch.get(entry.id)
              return u
                ? { ...entry, value: { assetId: u.assetId, previewUrl: u.previewUrl } }
                : entry
            })
          )
        }

        const submitPrompt = buildSubmitPrompt(extByIdx)
        const payload: Record<string, unknown> = {
          models: snapModels,
          prompt: submitPrompt,
          image_references: resolvedUrls,
          // Pass the client-generated generation_id so the backend uses it
          // verbatim when creating items + broadcasting SSE events.
          generation_id: genId,
          params: {
            aspect_ratio: snapAspect,
            resolution: snapResolution,
            num_images: snapNumImages,
          },
        }
        if (snapProjectId) {
          payload.project_id = snapProjectId
          payload.key_frame_id = snapKeyFrameId
        }

        await apiRequest("/generate/image", {
          method: "POST",
          body: JSON.stringify(payload),
        })

        // SSE-loss fallback. Each click owns its own polling loop keyed by
        // its generation_id, so concurrent batches converge independently.
        // Primary path is the lightweight /generations/{project_id} query;
        // if that endpoint isn't reachable (404 / not-yet-reloaded backend
        // / transient error) we fall back to the full /projects/{id}
        // payload, which is the same call that makes a manual refresh work.
        if (!snapProjectId) return
        const expected = snapModels.length * snapNumImages
        const startedAt = Date.now()
        const MAX_MS = 5 * 60 * 1000
        const INTERVAL_MS = 3000

        const fetchMatching = async (): Promise<{ status?: string }[] | null> => {
          try {
            const data = (await apiRequest(
              `/generations/${snapProjectId}?generation_id=${encodeURIComponent(genId)}`
            )) as { items?: { status?: string }[] }
            return data.items ?? []
          } catch {
            try {
              const data = (await apiRequest(`/projects/${snapProjectId}`)) as {
                key_frames?: {
                  items?: { generation_id?: string; status?: string }[]
                }[]
              }
              const out: { status?: string }[] = []
              for (const kf of data.key_frames ?? []) {
                for (const it of kf.items ?? []) {
                  if (it.generation_id === genId) out.push(it)
                }
              }
              return out
            } catch {
              return null
            }
          }
        }

        const poll = async () => {
          if (Date.now() - startedAt > MAX_MS) {
            clearOptimisticBatch(clientBatchId)
            return
          }
          const matching = await fetchMatching()
          if (matching && matching.length > 0) {
            // Refresh the full project on every tick that has matching
            // items so partially-completed batches surface immediately
            // (e.g. when num_images=4 and the first finishes early).
            await refreshCurrentProject(snapProjectId)
            const allTerminal =
              matching.length >= expected &&
              matching.every(
                (it) => it.status === "completed" || it.status === "failed"
              )
            if (allTerminal) {
              clearOptimisticBatch(clientBatchId)
              return
            }
          }
          window.setTimeout(poll, INTERVAL_MS)
        }
        window.setTimeout(poll, INTERVAL_MS)
      } catch (error) {
        if (optimisticAdded) clearOptimisticBatch(clientBatchId)
        toast.error(t("control.generationFailed"), {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    })()
  }

  // Find an existing reference entry that already points at `url` (string or
  // asset value). Files are never matched — they're freshly-dropped uploads.
  const findReferenceByUrl = (url: string): ReferenceEntry | undefined =>
    referenceItems.find(
      (r) =>
        (typeof r.value === "string" && r.value === url) ||
        (typeof r.value === "object" && !(r.value instanceof File) && r.value.previewUrl === url),
    )

  // Persists already-hosted URLs to the active keyframe's asset pool (a no-op
  // without a project/keyframe context) so they reopen with the keyframe.
  // Returns the resulting url -> KeyFrameAsset.id map.
  const persistReferencesToKeyFrame = async (urls: string[]): Promise<Map<string, string>> => {
    const projectId = currentProject?.id
    const kfId = activeKeyFrameId
    if (!projectId || !kfId || urls.length === 0) return new Map()
    try {
      const data = (await apiRequest(`/assets/${projectId}/${kfId}`, {
        method: "POST",
        body: JSON.stringify({ urls }),
      })) as { assets?: { id: string; url: string }[] }
      const map = new Map<string, string>()
      for (const a of data.assets ?? []) {
        if (urls.includes(a.url)) map.set(a.url, a.id)
      }
      return map
    } catch {
      return new Map()
    }
  }

  // Tracks entries removed (via the X button) while their attach was still
  // in flight, so the just-persisted KeyFrameAsset gets cleaned up instead of
  // reappearing on the keyframe once the attach call resolves.
  const removedIdsRef = React.useRef<Set<string>>(new Set())

  // Applies the result of persistReferencesToKeyFrame to a single entry: if
  // the user already removed it, deletes the freshly-created KeyFrameAsset;
  // otherwise upgrades the entry to the persisted {assetId, previewUrl} shape
  // and refreshes the project so switching keyframes and back keeps it.
  const finishAttach = (entryId: string, previewUrl: string, kfAssetId: string | undefined) => {
    const projectId = currentProject?.id
    const kfId = activeKeyFrameId
    if (removedIdsRef.current.has(entryId)) {
      removedIdsRef.current.delete(entryId)
      if (kfAssetId && projectId && kfId) {
        apiRequest(`/assets/${projectId}/${kfId}/${kfAssetId}`, { method: "DELETE" }).catch(() => { })
      }
      return
    }
    if (!kfAssetId) return
    setReferenceItems((prev) =>
      prev.map((e) => (e.id === entryId ? { ...e, value: { assetId: kfAssetId, previewUrl } } : e))
    )
    if (projectId) void refreshCurrentProject(projectId)
  }

  // Uploads a freshly-added file to app storage, then attaches it to the
  // active keyframe right away (rather than waiting for Generate) so it
  // survives switching keyframes or reopening the project.
  const uploadAndAttachFile = async (entryId: string, file: File) => {
    try {
      const res = await uploadReferenceImage(palette, file)
      const kfMap = await persistReferencesToKeyFrame([res.url])
      finishAttach(entryId, res.url, kfMap.get(res.url) ?? res.id)
    } catch {
      removedIdsRef.current.delete(entryId)
    }
  }

  // Add image files as references AND drop a chip into the prompt at the saved
  // caret — the shared behaviour for paste and for dropping files on the prompt.
  const addFilesAsReferenceChips = (imageFiles: File[]) => {
    const remaining = MAX_REFERENCES - referenceItems.length
    const toAdd = imageFiles.slice(0, remaining)
    if (toAdd.length === 0) {
      toast.error(t("control.refLimitReached", { max: MAX_REFERENCES }))
      return
    }
    const baseIdx = referenceItems.length
    const newEntries: ReferenceEntry[] = toAdd.map((file, i) => {
      const ext = (file.type.split("/")[1] || "png").toLowerCase()
      const named = file.name && /\.[a-z0-9]+$/i.test(file.name)
        ? file
        : new File([file], `pasted-${Date.now()}-${i}.${ext}`, { type: file.type })
      return { id: makeId(), value: named }
    })
    setReferenceItems((prev) => [...prev, ...newEntries])
    newEntries.forEach((entry, i) => insertChip(entry, baseIdx + i))
    newEntries.forEach((entry) => void uploadAndAttachFile(entry.id, entry.value as File))
    if (toAdd.length < imageFiles.length) {
      toast.error(t("control.refPartiallyAdded", { added: toAdd.length, total: imageFiles.length, max: MAX_REFERENCES }))
    }
  }

  // Drop an image URL (e.g. dragged from an already-generated image) into the
  // prompt as a chip. Reuses the existing reference if the same URL is already
  // there; otherwise registers it as a new reference first.
  const addUrlAsReferenceChip = (rawUrl: string) => {
    const url = rawUrl.trim()
    if (!url) return
    const existing = findReferenceByUrl(url)
    if (existing) {
      insertChip(existing, referenceItems.findIndex((r) => r.id === existing.id))
      return
    }
    if (referenceItems.length >= MAX_REFERENCES) {
      toast.error(t("control.refLimitReached", { max: MAX_REFERENCES }))
      return
    }
    const entry: ReferenceEntry = { id: makeId(), value: url }
    const idx = referenceItems.length
    setReferenceItems((prev) => [...prev, entry])
    insertChip(entry, idx)
    void persistReferencesToKeyFrame([url]).then((map) => finishAttach(entry.id, url, map.get(url)))
  }

  // Add an image URL as a reference only (no prompt chip) — for drops on the
  // references strip. Deduplicates so the same generated image isn't added twice.
  const addUrlAsReference = (rawUrl: string) => {
    const url = rawUrl.trim()
    if (!url) return
    if (findReferenceByUrl(url)) return
    if (referenceItems.length >= MAX_REFERENCES) {
      toast.error(t("control.refLimitReached", { max: MAX_REFERENCES }))
      return
    }
    const entry: ReferenceEntry = { id: makeId(), value: url }
    setReferenceItems((prev) => [...prev, entry])
    void persistReferencesToKeyFrame([url]).then((map) => finishAttach(entry.id, url, map.get(url)))
  }

  // Place the caret at the drop point so a dropped chip lands where the cursor
  // was released (falls back to the end of the prompt).
  const setCaretFromPoint = (x: number, y: number) => {
    const div = promptRef.current
    if (!div) return
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    }
    let range: Range | null = null
    if (doc.caretRangeFromPoint) {
      range = doc.caretRangeFromPoint(x, y)
    } else if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(x, y)
      if (pos) {
        range = document.createRange()
        range.setStart(pos.offsetNode, pos.offset)
        range.collapse(true)
      }
    }
    if (range && div.contains(range.startContainer)) {
      const sel = window.getSelection()
      if (sel) {
        sel.removeAllRanges()
        sel.addRange(range)
      }
      lastSelectionRef.current = range.cloneRange()
    } else {
      div.focus()
      saveSelection()
    }
  }

  const handlePromptPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile()
        if (f) imageFiles.push(f)
      }
    }
    if (imageFiles.length === 0) return
    e.preventDefault()
    saveSelection()
    addFilesAsReferenceChips(imageFiles)
  }

  // Drop onto the prompt box: image files or an image URL (dragged from an
  // already-generated image) behave like paste — a chip appears inline and the
  // image is registered as a reference (deduplicated). Plain-text drags fall
  // through to the contentEditable's native text handling. While an image is
  // dragged over it, the prompt box highlights the same way the references
  // strip does (depth-tracked so child nodes don't flicker the highlight).
  const [isPromptDraggingOver, setIsPromptDraggingOver] = React.useState(false)
  const promptDragDepthRef = React.useRef(0)

  const promptDropHasImage = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer?.types ?? [])
    return types.includes("Files") || types.includes("text/uri-list")
  }

  const handlePromptDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!promptDropHasImage(e)) return
    e.preventDefault()
    promptDragDepthRef.current += 1
    setIsPromptDraggingOver(true)
  }

  const handlePromptDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!promptDropHasImage(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
  }

  const handlePromptDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!promptDropHasImage(e)) return
    promptDragDepthRef.current = Math.max(0, promptDragDepthRef.current - 1)
    if (promptDragDepthRef.current === 0) setIsPromptDraggingOver(false)
  }

  const handlePromptDrop = (e: React.DragEvent<HTMLDivElement>) => {
    promptDragDepthRef.current = 0
    setIsPromptDraggingOver(false)
    const types = Array.from(e.dataTransfer?.types ?? [])
    const hasFiles = types.includes("Files")
    if (!hasFiles && !types.includes("text/uri-list")) return
    const imageFiles = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
      f.type.startsWith("image/"),
    )
    const uri = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")
    if (imageFiles.length === 0 && !uri) return
    e.preventDefault()
    setCaretFromPoint(e.clientX, e.clientY)
    if (imageFiles.length > 0) addFilesAsReferenceChips(imageFiles)
    else addUrlAsReferenceChip(uri)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    addReferenceFiles(Array.from(files))
    e.target.value = ""
  }

  // Shared add-files helper used by the file picker AND drag-and-drop. Returns
  // the number of files actually appended (some may be skipped if the slot
  // limit is hit) so callers can decide whether to toast.
  const addReferenceFiles = (files: File[]): number => {
    const images = files.filter((f) => f.type.startsWith("image/"))
    if (images.length === 0) return 0
    const remaining = MAX_REFERENCES - referenceItems.length
    const toAdd = images.slice(0, remaining)
    if (toAdd.length === 0) {
      toast.error(t("control.refLimitReached", { max: MAX_REFERENCES }))
      return 0
    }
    const newEntries: ReferenceEntry[] = toAdd.map((file) => ({ id: makeId(), value: file }))
    setReferenceItems((prev) => [...prev, ...newEntries])
    newEntries.forEach((entry) => void uploadAndAttachFile(entry.id, entry.value as File))
    if (toAdd.length < images.length) {
      toast.error(t("control.refPartiallyAdded", { added: toAdd.length, total: images.length, max: MAX_REFERENCES }))
    }
    return toAdd.length
  }

  // Drag-and-drop state. We track the depth of nested dragenter/dragleave
  // events so passing the mouse over a child element (e.g. an existing
  // reference thumbnail) doesn't toggle the highlight off and on.
  const [isDraggingOver, setIsDraggingOver] = React.useState(false)
  const dragDepthRef = React.useRef(0)

  // Accept dropped image files OR an image URL dragged from an already-generated
  // image (which carries `text/uri-list`).
  const dropHasImage = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer?.types ?? [])
    // Ignore drags that originate from an existing reference thumbnail so the
    // box neither highlights nor re-adds the same image as a duplicate.
    if (types.includes(REFERENCE_DRAG_TYPE)) return false
    return types.includes("Files") || types.includes("text/uri-list")
  }

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dropHasImage(e)) return
    e.preventDefault()
    dragDepthRef.current += 1
    setIsDraggingOver(true)
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dropHasImage(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dropHasImage(e)) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDraggingOver(false)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dropHasImage(e)) return
    e.preventDefault()
    dragDepthRef.current = 0
    setIsDraggingOver(false)
    const dropped = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
      f.type.startsWith("image/"),
    )
    if (dropped.length > 0) {
      addReferenceFiles(dropped)
      return
    }
    const uri = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")
    if (uri) addUrlAsReference(uri)
  }

  const removeReference = (id: string) => {
    const entry = referenceItems.find((r) => r.id === id)
    if (entry && typeof entry.value === "object" && !(entry.value instanceof File) && "assetId" in entry.value) {
      const projectId = currentProject?.id
      const kfId = activeKeyFrameId
      if (projectId && kfId) {
        apiRequest(`/assets/${projectId}/${kfId}/${entry.value.assetId}`, { method: "DELETE" }).catch(() => { })
      }
    } else {
      // Not yet persisted (still uploading/attaching) — mark it removed so
      // the in-flight attach deletes the KeyFrameAsset once it lands instead
      // of leaving an orphaned reference on the keyframe.
      removedIdsRef.current.add(id)
    }
    setReferenceItems((prev) => prev.filter((r) => r.id !== id))
  }

  // Compact PROMPT / CHAT switcher, rendered at the top of each view.
  const modeSwitcher = (
    <div className="flex w-fit">
      {(["prompt", "chat"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          className={cn(
            "px-2.5 py-1 text-xs font-bold tracking-widest uppercase border border-border60 -ml-px first:ml-0 transition-colors",
            mode === m
              ? "bg-primary text-primary-foreground border-primary relative z-10"
              : "bg-background text-foreground hover:bg-secondary",
          )}
        >
          {m === "prompt" ? t("control.prompt") : "Chat"}
        </button>
      ))}
    </div>
  )

  return (
    <div ref={rootRef} className="w-[400px] h-full flex flex-col border-r overflow-hidden bg-secondary/30 border-border">

      {/* Model selector — single instance so it can animate. Collapses away
          (height + opacity) when switching to CHAT via the grid 1fr→0fr trick.
          Inline-styled so the transition doesn't depend on Tailwind arbitrary
          classes being present in the prebuilt compiled.css. */}
      <div
        className="shrink-0"
        style={{
          display: "grid",
          gridTemplateRows: mode === "chat" ? "0fr" : "1fr",
          opacity: mode === "chat" ? 0 : 1,
          transition: "grid-template-rows 300ms ease, opacity 250ms ease",
        }}
        aria-hidden={mode === "chat"}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="p-3 border-b border-border50">
            <div className="border border-border60 overflow-x-auto overflow-y-hidden no-scrollbar">
              <ModelTabsHeader
                scrollable
                models={imageModelOptions}
                selected={selectedModels}
                onToggle={(v) => setSelectedModels((prev) =>
                  prev.includes(v)
                    ? prev.length > 1 ? prev.filter((m) => m !== v) : prev
                    : [...prev, v]
                )}
              />
            </div>
          </div>
        </div>
      </div>

      {mode === "chat" ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="p-3 pb-0 shrink-0">{modeSwitcher}</div>
          <ChatPanel />
        </div>
      ) : (
        <>
          {/* Prompt + Reference box */}
          <div className="flex-1 min-h-0 p-3 border-b border-border flex flex-col">
            <div className="pb-2">{modeSwitcher}</div>
            {/* <div className="flex items-center justify-between px-1 pb-2">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">{t("control.prompt")}</span>
              <span className="text-[10px] tracking-widest uppercase text-muted-foreground">{t("control.charCount", { count: prompt.length })}</span>
            </div> */}

            <div className="flex-1 min-h-0 flex flex-col border border-border60 focus-within:border-accent-foreground/30 transition-colors">
              {/* Prompt editor (contenteditable so chips can be inline) */}
              <div
                ref={promptRef}
                contentEditable
                suppressContentEditableWarning
                onInput={() => setPrompt(extractPromptText())}
                onPaste={handlePromptPaste}
                onDragEnter={handlePromptDragEnter}
                onDragOver={handlePromptDragOver}
                onDragLeave={handlePromptDragLeave}
                onDrop={handlePromptDrop}
                onKeyUp={saveSelection}
                onMouseUp={saveSelection}
                onBlur={saveSelection}
                data-placeholder={t("control.promptPlaceholder")}
                className={cn(
                  "flex-1 w-full overflow-y-auto bg-input/50 px-3 pt-3 pb-2 text-sm leading-relaxed outline-none whitespace-pre-wrap break-words transition-colors",
                  "empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/40",
                  isPromptDraggingOver && "bg-primary/10 ring-2 ring-primary/60 ring-inset"
                )}
              />

              {/* References strip — also a drop target for image files. */}
              <div
                className={cn(
                  "relative border-t border-border60 bg-input/50 transition-colors",
                  isDraggingOver && "bg-primary/10 ring-2 ring-primary/60 ring-inset",
                )}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="flex items-center justify-between px-3 pt-2">
                  <span className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">{t("control.references")}</span>
                  <span className="text-[10px] tracking-widest uppercase text-muted-foreground">
                    {t("control.refCount", { count: referenceItems.length, max: MAX_REFERENCES })}
                  </span>
                </div>
                {/* Drop hint as a banner directly under the header — stays ABOVE the
                reference thumbnails (instead of a centered overlay that lands in
                the middle/below them). */}
                {isDraggingOver && (
                  <div className="px-3 pb-1 pointer-events-none">
                    <span className="text-[10px] tracking-widest uppercase font-semibold text-primary">
                      {t("control.dropToAdd")}
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
                  {referenceItems.map((entry, idx) => (
                    <div
                      key={entry.id}
                      className="relative group/ref size-12 border border-border60 overflow-hidden cursor-pointer"
                      onClick={() => insertChip(entry, idx)}
                      // Keep references draggable (e.g. into the prompt box to insert a
                      // chip), but tag the drag so the references box can ignore it —
                      // dropping an existing reference back here must NOT re-add it.
                      onDragStart={(e) => {
                        const url = getPreviewUrl(entry.value)
                        e.dataTransfer.setData(REFERENCE_DRAG_TYPE, entry.id)
                        e.dataTransfer.setData("text/uri-list", url)
                        e.dataTransfer.setData("text/plain", url)
                        e.dataTransfer.effectAllowed = "copy"
                      }}
                      title={`Insert R${idx + 1} into prompt`}
                    >
                      <img src={getPreviewUrl(entry.value)} alt="" className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 left-0 px-1 text-[10px] font-semibold tracking-wide bg-black/60 text-white">
                        R{idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setViewerUrl(getPreviewUrl(entry.value))
                        }}
                        className="absolute top-0 left-0 size-4 bg-black/70 text-white flex items-center justify-center opacity-0 group-hover/ref:opacity-100 transition-opacity"
                        title="View larger"
                      >
                        <IconArrowsMaximize className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeReference(entry.id)
                        }}
                        className="absolute top-0 right-0 size-4 bg-black/70 text-white flex items-center justify-center opacity-0 group-hover/ref:opacity-100 transition-opacity"
                        title={t("control.removeRef")}
                      >
                        <IconX className="size-3" />
                      </button>
                    </div>
                  ))}
                  {referenceItems.length < MAX_REFERENCES && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="size-12 border border-dashed border-border60 text-muted-foreground hover:border-primary/50 hover:text-foreground flex items-center justify-center transition-colors"
                      title={t("control.addRef")}
                    >
                      <IconPlus className="size-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* COUNT / ASPECT / RESOLUTION */}
          <div className="flex border-b border-border50">
            <ParamGroup label={t("control.count")} options={COUNT_OPTIONS} value={numOutputs} onChange={setNumOutputs} />
            <ParamGroup label={t("control.aspect")} options={ASPECT_OPTIONS} value={aspectRatio} onChange={setAspectRatio} />
            <ParamGroup label={t("control.resolution")} options={RESOLUTION_OPTIONS} value={resolution} onChange={setResolution} />
          </div>

          {/* Generate */}
          <div className="p-3">
            <Button
              onClick={handleGenerate}
              disabled={!prompt.trim()}
              size={"lg"}
              className="justify-between w-full"
            >
              <span>{t("control.generate")}</span>
              <span className="text-lg font-semibold leading-none">→</span>
            </Button>
          </div>
        </>
      )}

      {/* Large reference image viewer, portaled to the plugin root so the OS
          sandbox wrapper can't re-scope the fixed overlay or trap its clicks.
          Click the backdrop, the close button, or press Escape to dismiss. */}
      {viewerUrl && viewerHost &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
            onClick={() => setViewerUrl(null)}
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              onClick={() => setViewerUrl(null)}
              aria-label="Close"
              className="absolute z-10 cursor-pointer top-4 right-4 size-9 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center text-white transition-colors"
            >
              <IconX className="size-5" />
            </button>
            <img
              src={viewerUrl}
              alt="Reference preview"
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>,
          viewerHost,
        )}
    </div>
  )
}
