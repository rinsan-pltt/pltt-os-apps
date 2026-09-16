"use client"

/**
 * Auth bridge. Plugin identity is owned by Palette OS — `usePlatform()` from
 * `@palettelab/sdk` returns the authenticated user, organization, and plugin
 * id that the host injects when mounting the plugin. There is no plugin-side
 * JWT / OAuth flow; the SDK's `apiFetch` (and same-origin `EventSource`) ride
 * the host session cookie.
 *
 * Components in this plugin still call `useAuth()` from earlier code, so we
 * keep that hook as a thin re-export of the platform user with a stable
 * reference shape — no `token`, no `login`/`logout` (Palette OS owns both).
 */
import * as React from "react"
import { usePlatform } from "@palettelab/sdk"

export interface AuthUser {
  id: string
  email?: string | null
  name?: string | null
  picture?: string | null
}

export interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const platform = usePlatform()
  const platformUser = platform?.user as
    | { id?: string; email?: string; name?: string; picture?: string }
    | undefined

  // Stabilize the user object: without this, every render produced a new
  // object reference even when the underlying scalars hadn't changed, so
  // every consumer's `useEffect` keyed on `user` (notably the SSE
  // EventSource) tore down and reopened on every parent re-render and
  // dropped in-flight events.
  const id = platformUser?.id ? String(platformUser.id) : null
  const email = platformUser?.email ?? null
  const name = platformUser?.name ?? null
  const picture = platformUser?.picture ?? null
  const user: AuthUser | null = React.useMemo(
    () => (id ? { id, email, name, picture } : null),
    [id, email, name, picture],
  )

  const value: AuthContextValue = React.useMemo(
    () => ({ user, loading: false }),
    [user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext)
  if (!ctx) {
    // Degraded fallback for code that mounts before AuthProvider.
    return { user: null, loading: true }
  }
  return ctx
}
