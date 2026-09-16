import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-ui font-medium",
    "transition-[background-color,border-color,color,box-shadow] duration-[var(--dt-dur-instant)] ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    "cursor-pointer select-none",
    // Every size keeps a 44px pointer target regardless of its visual height
    // (WCAG 2.5.8 / 2.5.5). `sm` was 32px and `icon` 36px, which is a hard miss
    // on touch — and `icon` buttons are how this app exposes rotate, delete,
    // zoom and close. The overlay is transparent and behind the content, so it
    // changes nothing visually.
    "after:absolute after:left-1/2 after:top-1/2 after:size-full after:min-h-[44px] after:min-w-[44px]",
    "after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[var(--dt-shadow-sm)] hover:bg-primary-hover",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
        outline: "border border-input bg-card text-foreground hover:border-primary hover:bg-accent hover:text-accent-foreground",
        ghost: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground shadow-[var(--dt-shadow-sm)] hover:brightness-110",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3.5 text-caption",
        lg: "h-11 px-6",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
)
Button.displayName = "Button"

export { Button, buttonVariants }
