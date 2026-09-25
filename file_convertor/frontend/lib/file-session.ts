"use client"

import * as React from "react"

/**
 * The file the user is working on, for as long as the app is open.
 *
 * The section workspace used to hold this in component state, which survived
 * switching tools inside a section and nothing else: the route's component
 * remounts when the sidebar moves between categories, so a PDF dropped in
 * Organize was gone by the time Compare PDF was opened in PDF Intelligence —
 * the one journey "upload once" is supposed to cover.
 *
 * A module-level store rather than a context provider, deliberately. It does
 * not depend on where a provider is mounted or on what React decides to
 * remount, and its natural lifetime is exactly right: a `File` is a handle to
 * bytes the browser is holding, so it cannot outlive the page anyway. A reload
 * starts empty, which is correct — there is nothing left to point at.
 */

export interface DataRoomRef {
  id: number
  name: string
}

export interface FileSession {
  files: File[]
  dataRoomFile: DataRoomRef | null
}

const EMPTY: FileSession = { files: [], dataRoomFile: null }

let state: FileSession = EMPTY
const listeners = new Set<() => void>()

function publish(next: FileSession) {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Stable between changes, which is what `useSyncExternalStore` requires — a
// fresh object per call would re-render forever.
const getSnapshot = () => state
const getServerSnapshot = () => EMPTY

export function setSessionFiles(files: File[]) {
  if (files === state.files) return
  publish({ ...state, files })
}

export function setSessionDataRoomFile(dataRoomFile: DataRoomRef | null) {
  if (dataRoomFile === state.dataRoomFile) return
  publish({ ...state, dataRoomFile })
}

export function clearSession() {
  publish(EMPTY)
}

export function useFileSession(): FileSession {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
