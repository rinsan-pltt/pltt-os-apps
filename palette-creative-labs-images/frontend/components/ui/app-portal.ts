"use client"

import * as React from "react"

const PlttCreativePortalContext = React.createContext<HTMLElement | null>(null)

function PlttCreativePortalProvider({
  container,
  children,
}: {
  container: HTMLElement | null
  children: React.ReactNode
}) {
  return React.createElement(
    PlttCreativePortalContext.Provider,
    { value: container },
    children
  )
}

function usePlttCreativePortalContainer() {
  return React.useContext(PlttCreativePortalContext)
}

export { PlttCreativePortalProvider, usePlttCreativePortalContainer }
