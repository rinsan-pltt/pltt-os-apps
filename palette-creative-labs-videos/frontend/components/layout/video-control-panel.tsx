"use client"

import React from "react"
import { IconSparkles, IconPhotoPlus, IconChevronRight, IconChevronLeft } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { apiRequest } from "@/lib/api-helper"
import { toast } from "@/components/ui/sonner"
import { useProjectContext, type KeyFrameVideoRefs } from "@/components/providers/project-context"
import { cn } from "@/lib/utils"
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// import { ModelSelector } from "./model-selector"
import { VideoGenerationParameters } from "./video-generation-parameters"
import { VideoPromptHelpers } from "./video-prompt-helpers"
import { InspirationsPanel } from "./inspirations-panel"
import { PresetsPanel } from "./presets-panel"
// import { ModelsPanel } from "./models-panel"
import { videoModelOptions, inspirationCategories, presetCategories, getDurationOptions, getResolutionOptions, getAspectRatioOptions } from "./video-helper"
import { useModelContext } from "@/components/providers/model-context"
import { ModelTabsHeader } from "./model-tabs-header"
import { ReferenceSlot, type RefImage } from "./reference-slot"
import { ElementsEditor, makeEmptyElement, type VideoElement } from "./elements-editor"
import { PromptInput, type Mention } from "./prompt-input"
import { usePromptComposer } from "@/components/providers/prompt-composer-context"
import { uploadReferenceImage } from "@/lib/gcs-upload-helper"
import { useT } from "@/lib/i18n"

// `pltt dev` serves the simulator on localhost; the bundler hardcodes
// NODE_ENV="production", so detect the dev host at runtime instead.
const isDevHost =
  typeof window !== "undefined" &&
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(window.location.hostname)
// LTX Video is dev-only.
const DEV_ONLY_MODELS = new Set(["ltx_video"])
const visibleVideoModels = videoModelOptions.filter((m) => isDevHost || !DEV_ONLY_MODELS.has(m.value))
const visibleVideoModelValues = new Set(visibleVideoModels.map((m) => m.value))
const DEFAULT_VIDEO_MODEL = "kling_3_0_pro"

// Mount/unmount wrapper with a symmetric EXIT: children keep their own
// entry animation (animate-in slide-in-from-top), and on hide the row
// collapses back up (height + fade + upward slide) before unmounting —
// React can't animate unmount, so the node stays mounted until the exit
// transition ends.
const AnimatedReveal = ({
  show,
  children,
  direction = "down",
  className,
}: {
  show: boolean
  children: React.ReactNode
  // "down": collapsed rest sits above (slides down into place, the default).
  // "up": collapsed rest sits below (slides up into place) — used where a
  // sibling section is revealed/hidden in tandem and both should read as the
  // same bottom-to-top motion.
  direction?: "down" | "up"
  className?: string
}) => {
  const [mounted, setMounted] = React.useState(show)
  // Drives the transition classes. Re-mounting starts collapsed and expands a
  // tick later so re-appearing also slides (no animation on first load).
  const [expanded, setExpanded] = React.useState(show)
  React.useEffect(() => {
    if (show) {
      setMounted(true)
      const id = setTimeout(() => setExpanded(true), 20)
      return () => clearTimeout(id)
    }
    setExpanded(false)
  }, [show])
  if (!show && !mounted) return null
  return (
    <div
      aria-hidden={!show}
      onTransitionEnd={(e) => {
        if (!show && e.target === e.currentTarget) setMounted(false)
      }}
      className={cn(
        // shrink-0: as a flex child the wrapper must KEEP its content height —
        // letting it shrink makes overflow-hidden clip the section (elements /
        // multishot vanishing) instead of the panel column growing + scrolling.
        "grid shrink-0 overflow-hidden transition-all duration-500 ease-in-out",
        expanded
          ? "grid-rows-[1fr] opacity-100 translate-y-0"
          : cn(
              "grid-rows-[0fr] opacity-0 pointer-events-none",
              direction === "up" ? "translate-y-2" : "-translate-y-2",
            ),
        className,
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

import { CustomMultiShot } from "./custom-multi-shot"

export const VideoControlPanel = () => {
  const { t } = useT()
  const { selectedModels, setSelectedModels, setMode } = useModelContext()
  const { currentProject, setCurrentProject, activeKeyFrameId, setActiveSceneId } = useProjectContext()
  const composer = usePromptComposer()

  const [isInspirationsOpen, setIsInspirationsOpen] = React.useState(false)
  const [isPresetsOpen, setIsPresetsOpen] = React.useState(false)
  // const [isModelsOpen, setIsModelsOpen] = React.useState(false)
  const [prompt, setPrompt] = React.useState("")

  const [klingMode, setKlingMode] = React.useState("frames")
  const [isCustomMultiShot, setIsCustomMultiShot] = React.useState(false)
  const [shots, setShots] = React.useState([{ id: 1, prompt: "", duration: "5s" }])
  const selectedModifiers = React.useRef<Record<string, string>>({})

  // Generation parameters (lifted out of VideoGenerationParameters so this
  // panel can read them when building the request).
  const [aspectRatio, setAspectRatio] = React.useState("16:9")
  const [resolution, setResolution] = React.useState("1080p")
  const [duration, setDuration] = React.useState("5s")
  const [audioEnabled, setAudioEnabled] = React.useState(false)
  const [loading, setLoading] = React.useState(false)

  // Reference images. Only the end frame is its own slot.
  const [endImage, setEndImage] = React.useState<RefImage>(null)

  // Seedance can either take multiple reference images or start+end frames.
  const [seedanceMode, setSeedanceMode] = React.useState<"references" | "frames">("frames")
  // Canonical reference-image list — the ONE source of truth for the image
  // slots across models: the Seedance multi-ref grid shows all of it, while
  // the start-frame slot (Kling/Seedance frames) and the single reference
  // slot (LTX) both edit its FIRST entry. Adding a start image on one model
  // therefore shows up as the reference image on another, and vice versa.
  const [seedanceRefs, setSeedanceRefs] = React.useState<RefImage[]>([null])
  const MAX_SEEDANCE_REFS = 9
  const setSeedanceRef = (index: number, value: RefImage) => {
    setSeedanceRefs((prev) => {
      const arr = [...prev]
      arr[index] = value
      const filled = arr.filter(Boolean) as RefImage[]
      // keep one trailing empty slot so more can be added (up to the max)
      return filled.length < MAX_SEEDANCE_REFS ? [...filled, null] : filled
    })
  }
  const startImage: RefImage = seedanceRefs.find(Boolean) ?? null
  const setStartImage = (v: RefImage) => setSeedanceRef(0, v)
  const refImage = startImage
  const setRefImage = setStartImage

  // Kling "Elements" (characters/objects), referenced in the prompt as @Element1…
  const [showElements, setShowElements] = React.useState(false)
  const [elements, setElements] = React.useState<VideoElement[]>([])

  // Kling and Seedance support start + end frames; LTX uses a single reference
  // image. Show start/end only when every selected model supports it.
  const startEndMode =
    selectedModels.length > 0 &&
    selectedModels.every((m) => m.startsWith("kling") || m === "seedance_2_0")

  // Every selected model is a Kling variant (3.0 Pro, o3 Pro, or both at
  // once) — both accept start/end frames, so the Frames/Multishot tab
  // shouldn't collapse just because more than one is selected.
  const allKlingModels = selectedModels.length > 0 && selectedModels.every((m) => m.startsWith("kling"))

  // Elements are only supported by Kling 3.0 Pro (not o3 Pro).
  const elementsCapable = selectedModels.length === 1 && selectedModels[0] === "kling_3_0_pro"

  // Seedance-only: offers the References/Frames switch.
  const seedanceOnly = selectedModels.length === 1 && selectedModels[0] === "seedance_2_0"
  const seedanceRefsMode = seedanceOnly && seedanceMode === "references"

  // ---- Persisted project video inputs --------------------------------------
  // Start/end frames, reference images and elements live on the PROJECT
  // (video_refs): the same refs follow the user across key frames. Restored
  // once when the project opens, auto-saved on change, kept until removed.
  const hydratedProjectRef = React.useRef<string | null>(null)
  const lastSavedRef = React.useRef<string>("")
  const saveSeqRef = React.useRef(0)

  const toUrlRef = (u?: string | null): RefImage => (u ? { url: u, previewUrl: u } : null)

  React.useEffect(() => {
    const proj = currentProject
    if (!proj || hydratedProjectRef.current === proj.id) return
    hydratedProjectRef.current = proj.id
    // Legacy projects saved refs per keyframe — fall back to the active
    // keyframe's copy (or the first keyframe that has any) when the project
    // itself has none yet.
    const hasAny = (v?: KeyFrameVideoRefs | null) =>
      !!v &&
      (!!v.start_image ||
        !!v.end_image ||
        (v.reference_images?.length ?? 0) > 0 ||
        (v.elements?.length ?? 0) > 0)
    const vr: KeyFrameVideoRefs =
      proj.video_refs ??
      (() => {
        const kfs = proj.key_frames ?? []
        const active = kfs.find((k) => k.id === activeKeyFrameId)
        return (
          (hasAny(active?.video_refs) ? active?.video_refs : undefined) ??
          kfs.find((k) => hasAny(k.video_refs))?.video_refs ??
          {}
        )
      })()
    setEndImage(toUrlRef(vr.end_image))
    // start_image and the reference list share one slot list (start = first
    // entry) — merge older rows that stored them separately.
    const urls = [...(vr.reference_images ?? [])]
    if (vr.start_image && !urls.includes(vr.start_image)) urls.unshift(vr.start_image)
    const refs = urls.map((u) => toUrlRef(u))
    setSeedanceRefs(refs.length < MAX_SEEDANCE_REFS ? [...refs, null] : refs)
    const els: VideoElement[] = (vr.elements ?? []).map((e, i) => {
      const elRefs = (e.reference_images ?? []).map(toUrlRef)
      return {
        id: Date.now() + i,
        frontal: toUrlRef(e.frontal_image),
        references: elRefs.length < 3 ? [...elRefs, null] : elRefs,
      }
    })
    setElements(els)
    setShowElements(els.length > 0)
    // Remember the server state so the save effect doesn't immediately
    // re-PUT what was just loaded.
    lastSavedRef.current = JSON.stringify({
      start_image: urls[0] ?? null,
      end_image: vr.end_image ?? null,
      reference_images: urls,
      elements: (vr.elements ?? []).map((e, i) => ({
        name: e.name ?? `Element${i + 1}`,
        frontal_image: e.frontal_image ?? null,
        reference_images: e.reference_images ?? [],
      })),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject])

  // Auto-save (debounced). Local files are uploaded first, then the slots are
  // swapped to the hosted URLs so neither the next save nor Generate
  // re-uploads the same bytes.
  React.useEffect(() => {
    const projectId = currentProject?.id
    if (!projectId || hydratedProjectRef.current !== projectId) return
    const seq = ++saveSeqRef.current
    const timer = setTimeout(async () => {
      try {
        const resolve = async (img: RefImage): Promise<string | null> => {
          if (!img) return null
          if (img.file) return (await uploadReferenceImage(null, img.file)).url as string
          return img.url
        }
        const refsResolved = await Promise.all(seedanceRefs.map(resolve))
        const elsResolved = await Promise.all(
          elements.map(async (el) => ({
            frontal: await resolve(el.frontal),
            refs: await Promise.all(el.references.map(resolve)),
          })),
        )
        if (seq !== saveSeqRef.current) return // superseded while uploading
        const payload = {
          // start image IS the first reference (shared slot).
          start_image: (refsResolved.find(Boolean) as string | undefined) ?? null,
          end_image: await resolve(endImage),
          reference_images: refsResolved.filter(Boolean) as string[],
          elements: elsResolved
            .map((r, i) => ({
              name: `Element${i + 1}`,
              frontal_image: r.frontal,
              reference_images: r.refs.filter(Boolean) as string[],
            }))
            .filter((e) => e.frontal_image || e.reference_images.length > 0),
        }
        const json = JSON.stringify(payload)
        if (json === lastSavedRef.current) return
        await apiRequest(`/projects/${projectId}/video-refs`, {
          method: "PUT",
          body: json,
        })
        lastSavedRef.current = json
        // Mirror the save into the context copy of the project so a refetch
        // race can't hydrate stale slots over what was just saved.
        setCurrentProject((prev) =>
          prev && prev.id === projectId ? { ...prev, video_refs: payload } : prev,
        )
        if (seq !== saveSeqRef.current) return
        // Swap freshly-uploaded files to their hosted URLs (no-ops otherwise).
        // The start/reference slot is covered by the seedanceRefs swap below.
        const swap = (img: RefImage, url: string | null | undefined): RefImage =>
          img?.file && url ? { url, previewUrl: url } : img
        setEndImage((p) => swap(p, payload.end_image))
        setSeedanceRefs((prev) => prev.map((img, i) => swap(img, refsResolved[i])))
        setElements((prev) =>
          prev.map((el, i) => {
            const r = elsResolved[i]
            if (!r) return el
            return {
              ...el,
              frontal: swap(el.frontal, r.frontal),
              references: el.references.map((ref, j) => swap(ref, r.refs[j])),
            }
          }),
        )
      } catch (e) {
        console.error("Failed to save keyframe video refs:", e)
      }
    }, 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endImage, seedanceRefs, elements, currentProject?.id])

  // Landing on the video workspace, switch the shared model context into
  // "video" mode and drop any image models that were selected elsewhere.
  React.useEffect(() => {
    setMode("video")
    setSelectedModels((prev) => {
      // Keep only currently-visible video models (drops the dev-only LTX in
      // production); fall back to the default when nothing valid remains.
      const visible = prev.filter((v) => visibleVideoModelValues.has(v))
      return visible.length ? visible : [DEFAULT_VIDEO_MODEL]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    setIsCustomMultiShot(false)
  }, [selectedModels])

  // "Remix": a generated video's prompt AND settings were pushed back into
  // the composer — restore the model, parameters and the input images the
  // video was generated with (older items may only carry some of them).
  React.useEffect(() => {
    const p = composer?.pending
    if (!p) return
    setPrompt(p.text)
    const s = p.settings
    if (!s) return
    if (s.model_name && videoModelOptions.some((m) => m.value === s.model_name)) {
      setSelectedModels([s.model_name])
    }
    if (s.aspect_ratio) setAspectRatio(s.aspect_ratio)
    if (s.resolution) setResolution(s.resolution)
    if (s.duration) setDuration(/s$/i.test(s.duration) ? s.duration : `${s.duration}s`)
    // Input images — the panel mirrors the remixed video exactly: slots are
    // set to the images it recorded, and CLEARED when it was text-to-video
    // (no images), so leftover references don't sneak into the regeneration.
    const urls = [...(s.reference_images ?? [])]
    if (s.start_image && !urls.includes(s.start_image)) urls.unshift(s.start_image)
    const refs = urls.map((u) => toUrlRef(u))
    setSeedanceRefs(refs.length && refs.length >= MAX_SEEDANCE_REFS ? refs : [...refs, null])
    setEndImage(toUrlRef(s.end_image))
    const els: VideoElement[] = (s.elements ?? []).map((e, i) => {
      const elRefs = (e.reference_images ?? []).map(toUrlRef)
      return {
        id: Date.now() + i,
        frontal: toUrlRef(e.frontal_image),
        references: elRefs.length < 3 ? [...elRefs, null] : elRefs,
      }
    })
    setElements(els)
    setShowElements(els.length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composer?.pending?.id])

  // With a single frame the mention is "@IMAGE1"; once both frames exist it
  // splits into "@START_IMAGE"/"@END_IMAGE". When that transition happens,
  // rewrite an existing "@IMAGE1" in the prompt to match the frame it referred
  // to (legacy "#IMAGE1" prompts are rewritten too).
  const prevFramesRef = React.useRef({ start: false, end: false })
  React.useEffect(() => {
    const prev = prevFramesRef.current
    const hasStart = !!startImage
    const hasEnd = !!endImage
    const wasSingle = prev.start !== prev.end
    if (wasSingle && hasStart && hasEnd) {
      const replacement = prev.start ? "@START_IMAGE" : "@END_IMAGE"
      setPrompt((p) => p.replace(/[#@]IMAGE1\b/g, replacement))
    }
    prevFramesRef.current = { start: hasStart, end: hasEnd }
  }, [startImage, endImage])

  // Durations offered for the current selection: a single model shows all of
  // its durations; multiple models show only the values common to all of them.
  const availableDurations = React.useMemo(
    () => getDurationOptions(selectedModels),
    [selectedModels],
  )

  // If the picked duration is no longer valid for the current selection (e.g.
  // after adding a model whose durations don't include it), snap to the first
  // available one.
  React.useEffect(() => {
    if (availableDurations.length && !availableDurations.includes(duration)) {
      setDuration(availableDurations[0])
    }
  }, [availableDurations, duration])

  // Same treatment for resolution (e.g. Seedance only supports 480p/720p).
  const availableResolutions = React.useMemo(
    () => getResolutionOptions(selectedModels),
    [selectedModels],
  )
  React.useEffect(() => {
    if (availableResolutions.length && !availableResolutions.includes(resolution)) {
      setResolution(availableResolutions[0])
    }
  }, [availableResolutions, resolution])

  // …and aspect ratio (e.g. only Seedance offers 3:4).
  const availableAspectRatios = React.useMemo(
    () => getAspectRatioOptions(selectedModels),
    [selectedModels],
  )
  React.useEffect(() => {
    if (availableAspectRatios.length && !availableAspectRatios.includes(aspectRatio)) {
      setAspectRatio(availableAspectRatios[0])
    }
  }, [availableAspectRatios, aspectRatio])

  // While a start frame is attached, the aspect ratio follows the image: its
  // natural dimensions are measured and the NEAREST available ratio is
  // auto-selected and locked (log-scale distance so portrait/landscape
  // mismatches weigh fairly). Removing the frame unlocks the selector.
  const [startFrameRatio, setStartFrameRatio] = React.useState<number | null>(null)
  React.useEffect(() => {
    const src = startImage?.previewUrl
    if (!src) {
      setStartFrameRatio(null)
      return
    }
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (!cancelled && img.naturalWidth > 0 && img.naturalHeight > 0) {
        setStartFrameRatio(img.naturalWidth / img.naturalHeight)
      }
    }
    // Unmeasurable image (e.g. a dev-storage file:// URL) — leave unlocked.
    img.onerror = () => {
      if (!cancelled) setStartFrameRatio(null)
    }
    img.src = src
    return () => {
      cancelled = true
    }
  }, [startImage?.previewUrl])

  const aspectLocked = startFrameRatio !== null
  React.useEffect(() => {
    if (startFrameRatio === null || availableAspectRatios.length === 0) return
    let best: string | null = null
    let bestDist = Infinity
    for (const opt of availableAspectRatios) {
      const [w, h] = opt.split(":").map(Number)
      if (!w || !h) continue
      const d = Math.abs(Math.log(startFrameRatio) - Math.log(w / h))
      if (d < bestDist) {
        bestDist = d
        best = opt
      }
    }
    if (best) setAspectRatio(best)
  }, [startFrameRatio, availableAspectRatios])

  const handleGenerate = async () => {
    // Kling always takes a base prompt; in multi-prompt mode the per-scene
    // prompts refine it, so we send the base first and append the scenes.
    const base = prompt.trim()
    const sceneText = shots.map((s) => s.prompt.trim()).filter(Boolean).join(" | ")
    const submitPrompt = isCustomMultiShot && sceneText
      ? (base ? `${base} | ${sceneText}` : sceneText)
      : base

    if (!submitPrompt) return
    if (currentProject && !activeKeyFrameId) {
      toast.error(t("control.selectKeyFrame"))
      return
    }

    setLoading(true)
    try {
      const payload: Record<string, unknown> = {
        models: selectedModels,
        prompt: submitPrompt,
        aspect_ratio: aspectRatio,
        duration,
        params: {
          resolution,
          audio: audioEnabled,
        },
      }

      // Start/end frames and reference images are sent as inputs whenever
      // they're attached — the @ mention is just an optional way to point
      // at a specific one from the prompt text, not a gate on whether it's
      // sent. Elements are the exception: those DO require an explicit
      // @Element{n} mention (checked below). Hosted URLs pass through
      // without re-upload.
      const mentioned = (name: string) =>
        submitPrompt.includes(`@${name}`) || submitPrompt.includes(`#${name}`)
      const uploadOne = async (img: RefImage) =>
        img ? (img.file ? (await uploadReferenceImage(null, img.file)).url : img.url) : undefined
      if (seedanceRefsMode) {
        const wanted = seedanceRefs.filter(Boolean) as RefImage[]
        const urls = (await Promise.all(wanted.map(uploadOne))).filter(Boolean) as string[]
        if (urls.length) payload.image_references = urls
      } else if (startEndMode) {
        const [s, e] = await Promise.all([
          startImage ? uploadOne(startImage) : Promise.resolve(undefined),
          endImage ? uploadOne(endImage) : Promise.resolve(undefined),
        ])
        if (s) payload.start_image = s
        if (e) payload.end_image = e
      } else {
        const r = refImage ? await uploadOne(refImage) : undefined
        if (r) payload.image_references = [r]
      }

      // Kling elements: only elements the prompt references (@Element1, …)
      // are uploaded and sent; names keep the editor's numbering so the
      // tokens stay aligned. A collapsed editor doesn't exclude them —
      // mention-gating alone decides.
      if (elementsCapable && elements.length > 0) {
        const uploaded = await Promise.all(
          elements.map(async (el, i) => {
            if (!mentioned(`Element${i + 1}`)) return null
            const frontal = await uploadOne(el.frontal)
            const refs = (await Promise.all(el.references.map(uploadOne))).filter(Boolean) as string[]
            if (!frontal && refs.length === 0) return null
            return { name: `Element${i + 1}`, frontal_image: frontal, reference_images: refs }
          }),
        )
        const validElements = uploaded.filter(Boolean)
        if (validElements.length > 0) payload.elements = validElements
      }

      if (currentProject) {
        payload.project_id = currentProject.id
        payload.key_frame_id = activeKeyFrameId
      }

      const res = await apiRequest("/generate/video", { method: "POST", body: JSON.stringify(payload) })
      // The backend opens a new scene for this run — surface it in the
      // sidebar right away and jump to it so the user watches the clips
      // arrive inside their scene.
      if (currentProject && activeKeyFrameId && res?.scene?.id) {
        setCurrentProject({
          ...currentProject,
          key_frames: (currentProject.key_frames ?? []).map((kf) =>
            kf.id === activeKeyFrameId
              ? { ...kf, scenes: [...(kf.scenes ?? []), res.scene] }
              : kf,
          ),
        })
        setActiveSceneId(res.scene.id)
      }
    } catch (error) {
      toast.error(t("video.generationFailed"), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoading(false)
    }
  }

  // In Kling multi-prompt mode the scene durations must add up to the total
  // duration exactly — otherwise generation is blocked (over or under). The
  // combined "scene | scene | scene" prompt is plain text, so it works the
  // same whether one or both Kling models are selected.
  const multiActive = allKlingModels && isCustomMultiShot && klingMode === "multishot"
  const scenesBalanced =
    shots.reduce((sum, s) => sum + (parseInt(s.duration, 10) || 0), 0) ===
    (parseInt(duration, 10) || 5)
  // In multishot mode every visible prompt box (base + each scene) is a
  // required field — the button only enables once all of them are filled.
  const canGenerate = multiActive
    ? prompt.trim().length > 0 && shots.every((s) => s.prompt.trim().length > 0) && scenesBalanced
    : prompt.trim().length > 0

  // `#` mention suggestions — only references the user has actually added.
  const promptMentions = React.useMemo<Mention[]>(() => {
    const list: Mention[] = []
    if (seedanceRefsMode) {
      // One token per uploaded reference (@IMAGE1…@IMAGE9).
      seedanceRefs.forEach((r, i) => {
        if (r) list.push({ token: `@IMAGE${i + 1}`, badge: `IMAGE${i + 1}`, name: `Image ${i + 1}`, group: "IMAGES" })
      })
    } else if (startEndMode) {
      const hasStart = !!startImage
      const hasEnd = !!endImage
      if (hasStart && hasEnd) {
        list.push({ token: "@START_IMAGE", badge: "START_IMAGE", name: "Start Image", group: "IMAGES" })
        list.push({ token: "@END_IMAGE", badge: "END_IMAGE", name: "End Image", group: "IMAGES" })
      } else if (hasStart || hasEnd) {
        // Only one frame uploaded — it's just "Image 1" until the pair completes.
        list.push({ token: "@IMAGE1", badge: "IMAGE1", name: "Image 1", group: "IMAGES" })
      }
    } else {
      if (refImage) list.push({ token: "@REFERENCE_IMAGE", badge: "REFERENCE_IMAGE", name: "Reference Image", group: "IMAGES" })
    }
    // Uploaded elements stay mentionable even while the editor is collapsed —
    // hiding the section doesn't remove them from the keyframe.
    if (elementsCapable) {
      elements.forEach((el, i) => {
        if (el.frontal || el.references.some(Boolean)) {
          list.push({ token: `@Element${i + 1}`, badge: `ELEMENT${i + 1}`, name: `Element ${i + 1}`, group: "ELEMENTS" })
        }
      })
    }
    return list
  }, [selectedModels, refImage, startImage, endImage, showElements, elements, startEndMode, elementsCapable, seedanceRefsMode, seedanceRefs])

  // Plain append/replace — the pre-LLM behaviour, kept as the fallback when
  // the rewrite endpoint is unavailable.
  const applyOptionLocally = (categoryId: string, option: string) => {
    setPrompt((prev) => {
      const lastValue = selectedModifiers.current[categoryId]

      // Replacement logic: if we have a record of a previous selection for this category
      // that is still present in the prompt string, swap it out.
      if (lastValue && lastValue.trim() !== "" && prev.includes(lastValue)) {
        selectedModifiers.current[categoryId] = option
        return prev.replace(lastValue, option)
      }

      // Addition logic: if it's a new category or the old one was removed manually
      selectedModifiers.current[categoryId] = option
      const trimmed = prev.trim()
      if (!trimmed) return option

      const separator = trimmed.endsWith(",") ? " " : ", "
      return `${trimmed}${separator}${option}`
    })
  }

  // A picked inspiration/preset is blended into the typed prompt by an LLM so
  // the result reads naturally (an empty prompt just takes the option as-is).
  const [rewriting, setRewriting] = React.useState(false)
  const handleOptionSelect = async (categoryId: string, option: string) => {
    if (!option || rewriting) return

    const current = prompt.trim()
    if (!current) {
      selectedModifiers.current[categoryId] = option
      setPrompt(option)
      return
    }

    setRewriting(true)
    try {
      const res = await apiRequest("/prompt/rewrite", {
        method: "POST",
        body: JSON.stringify({ prompt: current, feature: option }),
      })
      const next = (res?.prompt || "").trim()
      if (!next) throw new Error("empty rewrite")
      selectedModifiers.current[categoryId] = option
      setPrompt(next)
    } catch {
      // No LLM configured / request failed — fall back to plain append.
      applyOptionLocally(categoryId, option)
    } finally {
      setRewriting(false)
    }
  }

  return (
    <div className="w-[400px] shrink-0 h-full flex flex-col border-r border-border50 bg-background relative overflow-hidden">
      <ModelTabsHeader
        models={visibleVideoModels}
        selected={selectedModels}
        onToggle={(v) => setSelectedModels((prev) =>
          prev.includes(v)
            ? prev.length > 1 ? prev.filter((m) => m !== v) : prev
            : [...prev, v]
        )}
      />
      {/* 2. Main Hub: Input & Parameters (Takes remaining space) */}
      <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
        {/* Scrollable so the whole column (reference, elements, multishot scenes,
            "Add scene") is reachable when several sections are open at once. */}
        <div className="w-full relative group bg-accent/5 flex flex-col h-full overflow-y-auto sidebar-root">
          {/* Model-specific boxes slide DOWN in (their own animate-in) and,
              via AnimatedReveal, collapse back UP when they no longer apply
              (multiple models selected, model switched, …). */}
          <AnimatedReveal show={allKlingModels}>
            <div className="z-10 animate-in fade-in slide-in-from-top-2 duration-500 p-4">
              <Tabs onValueChange={(v) => setKlingMode(v)} defaultValue="frames" className="w-full bg-muted p-0.5 rounded-lg">
                <TabsList className="w-full h-full grid grid-cols-2 p-0 rounded-md">
                  <TabsTrigger value="frames" className="cursor-pointer text-sm rounded-md border border-transparent data-[state=active]:border-border data-[state=active]:cursor-default transition-all">
                    {t("video.frames")}
                  </TabsTrigger>
                  <TabsTrigger value="multishot" className="cursor-pointer text-sm rounded-md border border-transparent data-[state=active]:border-border data-[state=active]:cursor-default transition-all">
                    {t("video.multishot")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </AnimatedReveal>
          {/* Seedance: switch between multiple reference images and start/end frames. */}
          <AnimatedReveal show={seedanceOnly}>
            <div className="z-10 animate-in fade-in slide-in-from-top-2 duration-500 p-4">
              <Tabs value={seedanceMode} onValueChange={(v) => setSeedanceMode(v as "references" | "frames")} className="w-full bg-muted p-0.5 rounded-lg">
                <TabsList className="w-full h-full grid grid-cols-2 p-0 rounded-md">
                  <TabsTrigger value="frames" className="cursor-pointer text-sm rounded-md border border-transparent data-[state=active]:border-border data-[state=active]:cursor-default transition-all">
                    {t("video.startEndFrames")}
                  </TabsTrigger>
                  <TabsTrigger value="references" className="cursor-pointer text-sm rounded-md border border-transparent data-[state=active]:border-border data-[state=active]:cursor-default transition-all">
                    {t("video.referenceImages")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </AnimatedReveal>
          {/* Reference image upload — click to pick a file or drag one onto a
              slot. Seedance (references) takes multiple; start/end models take
              two frames; LTX takes a single reference. */}
          <div className="w-full px-4 pt-3 text-muted-foreground">
            {seedanceOnly ? (
              // Seedance's own References/Frames tabs swap in place, so they get
              // the same grow/shrink + fade reveal as the Kling/LTX model-select
              // sections instead of an abrupt unmount/remount. The two panes
              // are overlaid in the same grid cell so the one growing never
              // gets pushed around by the one shrinking — and the ACTIVE pane
              // gets z-10 so its slide-up plays on top of (not hidden behind)
              // the pane that's fading out.
              <div className="grid">
                <AnimatedReveal
                  show={seedanceRefsMode}
                  direction="up"
                  className={cn("[grid-area:1/1]", seedanceRefsMode ? "z-10" : "z-0")}
                >
                  <div className="flex flex-col gap-2">
                    {seedanceRefs.some(Boolean) ? (
                      // At least one uploaded → show the multi-slot grid.
                      <div className="flex flex-wrap gap-2">
                        {seedanceRefs.map((ref, i) => (
                          <ReferenceSlot
                            key={i}
                            className="w-24"
                            label={`Ref ${i + 1}`}
                            optionalLabel=""
                            value={ref}
                            onChange={(v) => setSeedanceRef(i, v)}
                            hint={t("video.seedanceRefsHint")}
                          />
                        ))}
                      </div>
                    ) : (
                      // Nothing uploaded yet → same big reference slot as LTX.
                      <ReferenceSlot
                        className="w-[50%]"
                        label={t("video.referenceImage")}
                        optionalLabel={t("video.optional")}
                        value={null}
                        onChange={(v) => setSeedanceRef(0, v)}
                        hint={t("video.seedanceRefsHint")}
                      />
                    )}
                  </div>
                </AnimatedReveal>
                <AnimatedReveal
                  show={!seedanceRefsMode}
                  direction="up"
                  className={cn("[grid-area:1/1]", !seedanceRefsMode ? "z-10" : "z-0")}
                >
                  <div className="grid grid-cols-2 gap-2">
                    <ReferenceSlot
                      label={t("video.startImage")}
                      optionalLabel={t("video.optional")}
                      value={startImage}
                      onChange={setStartImage}
                    />
                    <ReferenceSlot
                      label={t("video.endImage")}
                      optionalLabel={t("video.optional")}
                      value={endImage}
                      onChange={setEndImage}
                    />
                  </div>
                </AnimatedReveal>
              </div>
            ) : startEndMode ? (
              <div className="grid grid-cols-2 gap-2 animate-in fade-in zoom-in duration-500">
                <ReferenceSlot
                  label={t("video.startImage")}
                  optionalLabel={t("video.optional")}
                  value={startImage}
                  onChange={setStartImage}
                />
                <ReferenceSlot
                  label={t("video.endImage")}
                  optionalLabel={t("video.optional")}
                  value={endImage}
                  onChange={setEndImage}
                />
              </div>
            ) : (
              <ReferenceSlot
                className="w-[50%] animate-in fade-in zoom-in duration-500"
                label={t("video.referenceImage")}
                optionalLabel={t("video.optional")}
                value={refImage}
                onChange={setRefImage}
              />
            )}
          </div>

          {/* Elements (characters/objects) — Kling 3.0 Pro only. Each is a frontal
              image + up to 3 references, referenced in the prompt as @Element1. */}
          <AnimatedReveal show={elementsCapable}>
            <div className="w-full px-4 pt-2 flex flex-col gap-2">
              <Button
                className="w-full text-sm font-normal"
                size="sm"
                variant="outline"
                onClick={() => {
                  const next = !showElements
                  setShowElements(next)
                  if (next && elements.length === 0) setElements([makeEmptyElement(Date.now())])
                }}
              >
                {showElements ? t("video.hideElements") : t("video.addElements")}
              </Button>
              {showElements && (
                <>
                  <p className="text-[11px] text-muted-foreground/70">{t("video.elementsHint")}</p>
                  {/* No inner scroll — the whole panel column scrolls (one outer scrollbar). */}
                  <ElementsEditor elements={elements} setElements={setElements} />
                </>
              )}
            </div>
          </AnimatedReveal>
          <AnimatedReveal show={allKlingModels && klingMode === "multishot"}>
            <div className="w-full px-4 py-2">
              <Button
                className="w-full text-sm font-normal"
                size={"sm"}
                variant={"outline"}
                onClick={() => setIsCustomMultiShot(!isCustomMultiShot)}
              >
                {isCustomMultiShot && <IconChevronLeft className="size-4 text-muted-foreground" />}
                {isCustomMultiShot ? t("video.cancelCustomMultishot") : t("video.customMultishot")}
                {!isCustomMultiShot && <IconChevronRight className="size-4 text-muted-foreground" />}
              </Button>
            </div>
          </AnimatedReveal>

          {/* Prompt area. Non-multi: a single bordered box. Multi-prompt: the
              base prompt gets its own rectangle box on top, with the per-scene
              editor below it. */}
          <div
            // The VIDEO prompt is text-only: swallow drops so a dragged image
            // URL/file can't be inserted as text (references belong in the
            // slots above).
            onDrop={(e) => e.preventDefault()}
            className={cn(
              "mx-4 my-3 flex flex-col",
              multiActive
                // min height keeps the base prompt + scenes usable when the
                // column is scrolled (e.g. elements editor also open).
                ? "flex-1 min-h-[360px] gap-3"
                // min-h keeps the prompt box from collapsing (and overlapping the
                // presets/inspirations) when the elements editor is open; the
                // outer column scrolls instead.
                : "flex-1 min-h-[240px] border border-border60 focus-within:border-accent-foreground/30 transition-colors bg-background/40",
            )}
          >
            {multiActive ? (
              <>
                {/* Base prompt box */}
                <div className="shrink-0 rounded-xl border border-border60 focus-within:border-primary/60 transition-colors bg-background/40 overflow-hidden">
                  <PromptInput
                    value={prompt}
                    onChange={setPrompt}
                    mentions={promptMentions}
                    placeholder={t("video.basePromptPlaceholder")}
                    className="w-full min-h-[96px] p-4 bg-transparent border-none resize-none text-base font-light placeholder:text-muted-foreground/40 focus:ring-0 outline-none leading-relaxed"
                  />
                </div>
                {/* Per-scene editor (its own boxes) */}
                <CustomMultiShot
                  shots={shots}
                  setShots={setShots}
                  totalDuration={parseInt(duration, 10) || 5}
                />
              </>
            ) : (
              <>
                <PromptInput
                  value={prompt}
                  onChange={setPrompt}
                  mentions={promptMentions}
                  placeholder={t("video.placeholder")}
                  wrapperClassName="flex-1 min-h-0 flex"
                  className="flex-1 min-h-0 w-full p-4 bg-transparent border-none resize-none text-base font-light placeholder:text-muted-foreground/40 focus:ring-0 outline-none leading-relaxed"
                />
                {rewriting && (
                  <div className="px-4 pb-2 text-[11px] uppercase tracking-widest text-muted-foreground animate-pulse">
                    {t("video.rewriting")}
                  </div>
                )}
              </>
            )}
          </div>
          {!isCustomMultiShot && <VideoPromptHelpers
            isInspirationsOpen={isInspirationsOpen}
            setIsInspirationsOpen={(open) => {
              setIsInspirationsOpen(open)
              if (open) setIsPresetsOpen(false)
            }}
            isPresetsOpen={isPresetsOpen}
            setIsPresetsOpen={(open) => {
              setIsPresetsOpen(open)
              if (open) setIsInspirationsOpen(false)
            }}
          />}
        </div>
      </div>

      {/* 3. Generate Button (Sticky Bottom) */}
      <div className="p-4 border-t border-border50 bg-background">
        <VideoGenerationParameters
          aspectRatio={aspectRatio}
          setAspectRatio={setAspectRatio}
          availableAspectRatios={availableAspectRatios}
          aspectLocked={aspectLocked}
          resolution={resolution}
          setResolution={setResolution}
          availableResolutions={availableResolutions}
          duration={duration}
          setDuration={setDuration}
          availableDurations={availableDurations}
          audioEnabled={audioEnabled}
          setAudioEnabled={setAudioEnabled}
        />
        <Button
          className="w-full  group "
          onClick={handleGenerate}
          disabled={loading || rewriting || !canGenerate}
        >
          {loading ? t("video.generating") : t("video.generateVideo")}
          {/* <div className="ml-2 flex items-center gap-0.5 opacity-70">
            <span className="text-xs">25</span>
            <IconSparkles className="size-3.5" />
          </div> */}
        </Button>
      </div>

      {/* Right Side Panels */}
      {isInspirationsOpen && (
        <InspirationsPanel
          categories={inspirationCategories}
          onSelect={handleOptionSelect}
          onClose={() => setIsInspirationsOpen(false)}
        />
      )}
      {isPresetsOpen && (
        <PresetsPanel
          categories={presetCategories}
          onSelect={handleOptionSelect}
          onClose={() => setIsPresetsOpen(false)}
        />
      )}
    </div>
  )
}
