"use client"

import * as React from "react"
import { PluginProvider, type PluginComponentProps } from "@palettelab/sdk"
import { PaletteAppRouter } from "@palettelab/sdk/router"

import Layout from "@/app/layout"
import HomePage from "@/app/page"

// Single-screen app: the Palette OS story pipeline lives entirely on the
// root route (Home → Storyboard → Animate → Publish → Library are client
// side states, not routes). Legacy routes ("video", "explore", "archive",
// "dashboard", "projects/[id]") intentionally resolve to the same app.
const routes = [
  {
    id: "__root__",
    segments: [],
    score: 0,
    page: HomePage,
    layouts: [Layout],
  },
  // Old bookmarks / OS deep links to /video keep working.
  {
    id: "video",
    segments: [{ kind: "static", value: "video" }],
    score: 11,
    page: HomePage,
    layouts: [Layout],
  },
]

export default function PluginRoot(props: PluginComponentProps) {
  // Match the public SDK contract: Palette passes `{ platform }` to plugin
  // roots. The OS also wraps apps with PluginProvider; this keeps standalone
  // SDK execution correct without changing route behavior.
  return (
    <PluginProvider value={props.platform}>
      <PaletteAppRouter routes={routes as never} />
    </PluginProvider>
  )
}
