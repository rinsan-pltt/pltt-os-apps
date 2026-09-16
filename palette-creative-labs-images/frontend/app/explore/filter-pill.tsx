import React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export function FilterPill({
  active,
  onClick,
  children,
  className,
}: {
  active?: boolean
  onClick?: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <Button
      size="xs"
      onClick={onClick}
      variant={active ? "default" : "outline"}
      className={cn(
        className
      )}
    >
      {children}
    </Button>
  )
}
