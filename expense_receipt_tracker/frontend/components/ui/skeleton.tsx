import * as React from "react"

import { cn } from "@/lib/utils"

/** Layout-preserving loading placeholder. Always give it the dimensions of the
 *  content it stands in for, so nothing shifts when the real data lands. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton", className)} {...props} />
}
