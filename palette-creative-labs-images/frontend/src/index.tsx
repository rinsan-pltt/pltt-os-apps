"use client"

import * as React from "react"
import { PluginProvider, type PluginComponentProps } from "@palettelab/sdk"
import { PaletteAppRouter } from "@palettelab/sdk/router"

import Layout from "@/app/layout"
import HomePage from "@/app/page"
import DashboardPage from "@/app/dashboard/page"
import ExplorePage from "@/app/explore/page"
import ArchivePage from "@/app/archive/page"
import ArchiveByIdPage from "@/app/archive/[id]/page"
import ProjectByIdPage from "@/app/projects/[id]/page"

const routes = [
  {
    id: "archive/[id]",
    segments: [
      { kind: "static", value: "archive" },
      { kind: "dynamic", name: "id" },
    ],
    score: 17,
    page: ArchiveByIdPage,
    layouts: [Layout],
  },
  {
    id: "projects/[id]",
    segments: [
      { kind: "static", value: "projects" },
      { kind: "dynamic", name: "id" },
    ],
    score: 17,
    page: ProjectByIdPage,
    layouts: [Layout],
  },
  {
    id: "archive",
    segments: [{ kind: "static", value: "archive" }],
    score: 11,
    page: ArchivePage,
    layouts: [Layout],
  },
  {
    id: "dashboard",
    segments: [{ kind: "static", value: "dashboard" }],
    score: 11,
    page: DashboardPage,
    layouts: [Layout],
  },
  {
    id: "explore",
    segments: [{ kind: "static", value: "explore" }],
    score: 11,
    page: ExplorePage,
    layouts: [Layout],
  },
  {
    id: "__root__",
    segments: [],
    score: 0,
    page: HomePage,
    layouts: [Layout],
  },
]

export default function PluginRoot(props: PluginComponentProps) {
  // Match the public SDK contract: Palette passes `{ platform }` to plugin
  // roots. The OS also wraps apps with PluginProvider; this keeps standalone
  // SDK execution correct without changing route behavior.
  return (
    <PluginProvider  value={props.platform}>
      <PaletteAppRouter routes={routes as never} />
    </PluginProvider>
  )
}
