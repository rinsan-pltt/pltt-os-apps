"use client"

import * as React from "react"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * A workspace's outer surface — a card of its own, or nothing at all.
 *
 * On `/tools/<slug>` a workspace IS the page, so it draws its own card. In the
 * section workspace it is one part of a card the section draws: the tool's
 * name, the file it is working on and its controls belong to one object, and
 * a card inside that card was the reason the screen read as a stack of
 * unrelated panels rather than a tool you had picked up.
 */
export function PanelShell({
  embedded,
  className,
  children,
}: {
  embedded?: boolean
  className?: string
  children: React.ReactNode
}) {
  if (embedded) return <div className={cn("min-w-0", className)}>{children}</div>
  return <Card className={cn("min-w-0", className)}>{children}</Card>
}

/** The body of the surface above: padded inside a card, bare when embedded
 *  (the section has already padded its own card). */
export function PanelContent({
  embedded,
  className,
  children,
}: {
  embedded?: boolean
  className?: string
  children: React.ReactNode
}) {
  if (embedded) return <div className={cn("min-w-0", className)}>{children}</div>
  return <CardContent className={cn("min-w-0", className)}>{children}</CardContent>
}
