"use client"

import { VideoControlPanel } from "@/components/layout/video-control-panel"
import { VideoWorkspace } from "@/components/layout/video-workspace"
import { GenerationEventsProvider } from "@/components/providers/generation-events-context"
import { PromptComposerProvider } from "@/components/providers/prompt-composer-context"

export default function VideoPage() {
  return (
    // No project here — the provider falls back to the user-level SSE
    // channel, which the standalone image step needs.
    <GenerationEventsProvider>
      <PromptComposerProvider>
        <div className="flex flex-1 overflow-hidden">
          <VideoControlPanel />
          <VideoWorkspace />
        </div>
      </PromptComposerProvider>
    </GenerationEventsProvider>
  )
}
