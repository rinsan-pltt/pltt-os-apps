"use client"

// Root — the Palette OS story app. Standalone (project-less): sessions and
// generations live on the user's own SSE channel; no key frames involved.

import { GenerationEventsProvider } from "@/components/providers/generation-events-context"
import { StoryVideoProvider } from "@/components/providers/story-video-context"
import { StoryApp } from "@/components/story-os/app"

export default function Home() {
  return (
    <GenerationEventsProvider>
      <StoryVideoProvider>
        <StoryApp />
      </StoryVideoProvider>
    </GenerationEventsProvider>
  )
}
