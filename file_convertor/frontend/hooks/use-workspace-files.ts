"use client"

import * as React from "react"

/**
 * A workspace's uploaded files, either its own or its parent's.
 *
 * Every workspace in this app used to open with `useState<File[]>([])`, which
 * is why a file could not outlive the screen it was dropped on: pick another
 * tool and the state went with the unmounted component, so the same document
 * had to be uploaded again. The section workspace
 * (`components/layout/category-workspace.tsx`) owns one upload for the whole
 * category and hands it to whichever tool is selected, so that state has to be
 * liftable.
 *
 * Passing `files`/`onChange` makes the workspace controlled; passing neither
 * leaves it exactly as it was, which is what `/tools/<slug>` still does.
 */
export function useWorkspaceFiles(
  files?: File[],
  onChange?: (files: File[]) => void,
): [File[], (next: File[]) => void] {
  const [internal, setInternal] = React.useState<File[]>([])
  // Controlled iff BOTH are supplied. A `files` array with no way to change it
  // would leave the dropzone inert, which is worse than ignoring the prop.
  const controlled = files !== undefined && onChange !== undefined

  const setFiles = React.useCallback(
    (next: File[]) => {
      if (controlled) onChange!(next)
      else setInternal(next)
    },
    [controlled, onChange],
  )

  return [controlled ? files! : internal, setFiles]
}

/**
 * The props every workspace takes so the section screen can drive it.
 *
 * `embedded` says the upload lives above, on the section's own file bar: the
 * workspace keeps its options, its run button and its results, and drops only
 * the dropzone it would otherwise draw for itself.
 */
export interface WorkspaceFileProps {
  files?: File[]
  onFilesChange?: (files: File[]) => void
  embedded?: boolean
}
