import * as React from "react"

import { cn } from "@/lib/utils"

function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card text-card-foreground shadow-[var(--erx-shadow-sm)]",
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 p-5 sm:p-6", className)} {...props} />
}

/** Card titles were `<div>`s, so no card in the app was a heading and four of
 *  the five routes had exactly one h1 and nothing else — unnavigable by
 *  structure. `level` picks the right rank for where the card sits; cards are
 *  top-level sections under the page h1, so h2 is the default. */
function CardTitle({
  className,
  level = 2,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { level?: 2 | 3 | 4 }) {
  const Tag = `h${level}` as "h2" | "h3" | "h4"
  return <Tag className={cn("text-heading", className)} {...props} />
}

function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm text-muted-foreground", className)} {...props} />
}

function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // `pt-0` only when something (a CardHeader) is actually above it.
        // Unconditionally zeroing the top padding assumed every card had a
        // header; the ones that don't — the reports chart, the scan dropzone,
        // the status filters — had their content sitting flush against the
        // card's top border.
        "p-surface [&:not(:first-child)]:pt-0",
        className,
      )}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center p-5 pt-0 sm:p-6 sm:pt-0", className)} {...props} />
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
