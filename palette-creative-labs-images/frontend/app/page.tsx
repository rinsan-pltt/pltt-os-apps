"use client"

import { AppShell } from "@/components/layout/app-shell"
import { ProjectsPage } from "@/components/layout/projects-page"

export default function Home() {
  return (
    <AppShell>
      <div className="flex flex-1 overflow-hidden">
        <ProjectsPage />
      </div>
    </AppShell>
  )
}
