"use client"

import { AppShell } from "@/components/layout/app-shell"
import { ArchivePage } from "@/components/layout/archive-page"

export default function Archive() {
  return (
    <AppShell>
      <div className="flex flex-1 overflow-hidden">
        <ArchivePage />
      </div>
    </AppShell>
  )
}
