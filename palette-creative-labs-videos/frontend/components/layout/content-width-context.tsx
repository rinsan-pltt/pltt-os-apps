"use client"

import * as React from "react"

/**
 * Exposes the width of the AppShell content area (the `flex-1` region below the
 * header, measured in app-shell.tsx) to descendants. Pages use it for layout
 * that must respond to the app *window* width — not the browser viewport, which
 * Tailwind's media-query breakpoints and CSS container queries key off and which
 * differs from the window inside the Palette OS.
 */
const ContentWidthContext = React.createContext<number | null>(null)

export function ContentWidthProvider({
  width,
  children,
}: {
  width: number | null
  children: React.ReactNode
}) {
  return <ContentWidthContext.Provider value={width}>{children}</ContentWidthContext.Provider>
}

export function useContentWidth(): number | null {
  return React.useContext(ContentWidthContext)
}
