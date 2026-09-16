"use client"

import * as React from "react"

const PlttCreativeVideoPortalContext = React.createContext<HTMLElement | null>(null)

function PlttCreativeVideoPortalProvider({
  container,
  children,
}: {
  container: HTMLElement | null
  children: React.ReactNode
}) {
  return React.createElement(
    PlttCreativeVideoPortalContext.Provider,
    { value: container },
    children
  )
}

function usePlttCreativeVideoPortalContainer() {
  return React.useContext(PlttCreativeVideoPortalContext)
}

export { PlttCreativeVideoPortalProvider, usePlttCreativeVideoPortalContainer }
