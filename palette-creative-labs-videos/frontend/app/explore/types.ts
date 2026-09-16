import { videoModelOptions } from "@/components/layout/video-helper"

export interface Favourite {
  id?: string
  content_id?: string
  // Item kind ("image" | "video"). The detail modal picks its media element
  // from this; omitted means video (this app's historical default).
  type?: string
  url: string
  // First-frame still of a completed video, extracted server-side — shown as
  // the <video poster> so a preview never flashes black while the clip loads.
  thumbnail_url?: string | null
  prompt?: string
  model_name?: string
  name?: string
  project_name?: string
  project_id?: string
  key_frame_id?: string
  key_frame_name?: string
  aspect_ratio?: string
  resolution?: string
  duration?: string
  // Full generation params (incl. the input images) — lets "Remix" restore
  // the exact settings and reference frames this item was generated with.
  gen_params?: Record<string, unknown> | null
  image_references?: Array<string | { id?: string; url: string }>
  created_at?: string
  updated_at?: string
  group?: string | null
  url_before_upscale?: string | null
}

export type EngineFilter = "all" | string
export type MarkFilter = "all" | "none" | "marked" | string
export type GridMode = "random" | 1 | 2 | 3 | 4 | 5

export const MAX_COMPARE = 10

// 10 hex colors used as favourite "group" tags across the app.
export const MARK_COLORS = [
  "#FFD700", // yellow
  "#FF4136", // red
  "#2ECC40", // green
  "#0074D9", // blue
  "#FF851B", // orange
  "#B10DC9", // purple
  "#F012BE", // magenta
  "#39CCCC", // teal
  "#01FF70", // lime
  "#85144B", // maroon
]

export const VIDEO_ENGINE_PILLS: { label: string; value: EngineFilter }[] = [
  { label: "All Engines", value: "all" },
  // Combine label + version so the two Kling engines are distinct. LTX is
  // dev-only and not offered as an Explore filter.
  ...videoModelOptions
    .filter((m) => m.value !== "ltx_video")
    .map((m) => ({
      label: [m.label, m.version].filter(Boolean).join(" "),
      value: m.value,
    })),
]

export const GRID_COL_CLASS: Record<Exclude<GridMode, "random">, string> = {
  1: "columns-1",
  2: "columns-2",
  3: "columns-3",
  4: "columns-4",
  5: "columns-5",
}

export const COMPARE_COLS_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
}

export const COMPARE_ROWS_CLASS: Record<number, string> = {
  1: "grid-rows-1",
  2: "grid-rows-2",
}
