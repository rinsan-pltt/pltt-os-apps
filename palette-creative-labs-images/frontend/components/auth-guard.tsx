"use client"

/**
 * No-op shim. In pltt-agg the AuthGuard redirected unauthenticated users to
 * `/login`. As a Palette plugin, the host OS guarantees the user is signed in
 * before mounting the plugin, so this just passes children through.
 *
 * Kept so existing imports still resolve without code-wide find-and-replace.
 */
import * as React from "react"

export function AuthGuard({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
