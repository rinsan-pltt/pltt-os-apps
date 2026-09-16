"use client"

import * as React from "react"

import { NotFoundView } from "@/components/layout/not-found-view"
import { useColorMode } from "@/hooks/use-color-mode"
import { cn } from "@/lib/utils"

/**
 * The Palette router renders this route OUTSIDE the root layout, so `AppRoot`
 * never wraps it — which meant this one page had no `data-dt-root` and no
 * `dark` class, and would therefore have rendered the light palette inside a
 * dark host. The simulator hid that, because it injects the CSS unscoped and
 * the simulator's own `.dark` on `<html>` cascades in; on the platform the
 * stylesheet is scoped and it would not have.
 *
 * So this page carries the same two theme markers itself. It is the one place
 * duplicating them is correct — which is also why the screen itself lives in
 * `NotFoundView`: the pages that render it from INSIDE the layout must not
 * repeat this wrapper.
 */
export default function NotFound() {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const colorMode = useColorMode(rootRef)

  return (
    <div
      ref={rootRef}
      data-dt-root=""
      data-dt-theme={colorMode}
      className={cn(
        "flex h-full min-h-0 flex-col bg-background text-foreground antialiased",
        colorMode === "dark" && "dark",
      )}
      style={{ height: "100%" }}
    >
      <NotFoundView />
    </div>
  )
}
