"use client"

import * as React from "react"
import { IconLoader2, IconPlayerPlayFilled } from "@tabler/icons-react"
import { cn } from "@/lib/utils"

// The backend stores durations as bare seconds ("5"); render as "M:SS".
function formatDuration(d?: string | number): string | null {
  if (d === undefined || d === null || d === "") return null
  const secs = typeof d === "number" ? d : parseInt(String(d).replace(/[^0-9]/g, ""), 10)
  if (!Number.isFinite(secs)) return null
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

/**
 * Thumbnail-sized looping video that plays on hover and shows a play
 * affordance while idle. Used across the Archive and Explore galleries (the
 * video equivalent of the `<img>` thumbnails the image app rendered).
 */
export function HoverVideo({
  src,
  className,
  showPlayIcon = true,
  type,
  poster,
  duration,
}: {
  src: string
  className?: string
  showPlayIcon?: boolean
  // "image" renders a plain <img> — a <video> tag never decodes an image URL,
  // leaving a permanent grey skeleton. Auto-detected from the extension when
  // the caller doesn't know the type.
  type?: "image" | "video"
  // First-frame still extracted server-side when the video finished
  // generating. Shown via the native <video poster> so the thumbnail is
  // there immediately — no waiting on the clip itself to decode a frame.
  poster?: string | null
  // Total clip length (bare seconds, e.g. "7"). When given, shown as a
  // bottom-right badge — the clip's total length while idle, then a live
  // elapsed-time counter (reset to 0) once the hover preview starts playing.
  duration?: string
}) {
  const ref = React.useRef<HTMLVideoElement>(null)
  const [hovered, setHovered] = React.useState(false)
  // The video's first decoded frame is the thumbnail. Until it's ready we show
  // a skeleton placeholder so the card never flashes empty/black.
  const [loaded, setLoaded] = React.useState(false)
  // Elapsed playback seconds while the hover preview is running — resets to 0
  // whenever hover ends (and the clip pauses/rewinds), so it always starts
  // fresh on the next hover, looping in step with the video's own `loop`.
  const [elapsed, setElapsed] = React.useState(0)

  const isImage =
    type === "image" ||
    (type === undefined && /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(src))
  if (isImage) {
    return <img src={src} alt="" loading="lazy" className={cn("block", className)} />
  }

  return (
    <div
      className="relative size-full"
      onMouseEnter={() => {
        setHovered(true)
        ref.current?.play().catch(() => {})
      }}
      onMouseLeave={() => {
        setHovered(false)
        setElapsed(0)
        const v = ref.current
        if (v) {
          v.pause()
          v.currentTime = 0
        }
      }}
    >
      <video
        ref={ref}
        // `#t=0.1` nudges the browser to decode and paint a real first frame as
        // the poster even before playback, so the thumbnail is the video itself.
        // Only needed as a fallback when there's no server-extracted poster
        // (older items, or thumbnail generation failed) — with one, `poster`
        // paints instantly and this decode is never visibly needed.
        src={`${src}#t=0.1`}
        poster={poster ?? undefined}
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedData={() => setLoaded(true)}
        onTimeUpdate={(e) => setElapsed(Math.floor(e.currentTarget.currentTime))}
        className={cn("block", className)}
      />
      {!loaded && !poster && (
        <div className="absolute inset-0 bg-secondary/60 animate-pulse pointer-events-none" />
      )}
      {/* Loading spinner over the poster/skeleton until the clip itself has
          actually decoded a frame — shown even with a poster, since that's
          only a still; the spinner signals the clip is still on its way. */}
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="size-10 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center text-white/90">
            <IconLoader2 className="size-5 pltt-animate-spin" />
          </div>
        </div>
      )}
      {showPlayIcon && loaded && !hovered && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="size-10 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center text-white/90">
            <IconPlayerPlayFilled className="size-4" />
          </div>
        </div>
      )}
      {formatDuration(duration) && (
        <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-black/70 text-white text-[10px] font-semibold tabular-nums pointer-events-none">
          {hovered ? formatDuration(elapsed) : formatDuration(duration)}
        </span>
      )}
    </div>
  )
}
