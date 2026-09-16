import * as React from "react"

import { cn } from "@/lib/utils"

// Lucide-style chevron-down as an inline SVG data URI. Applied as a background
// image (rather than a wrapper + icon element) so the arrow works with every
// width/height/className a caller passes to the select, with no layout change.
// gray-500 (#6b7280) reads clearly on both light and dark backgrounds.
const CHEVRON_DOWN =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='24'%20height='24'" +
  "%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%236b7280'%20stroke-width='2'" +
  "%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpolyline%20points='6%209%2012%2015%2018%209'" +
  "/%3E%3C/svg%3E"

/** Styled native select — no portal/popper dependencies needed here. Shows a
 *  dropdown chevron whenever there's an actual choice to make (more than one
 *  <option>); a single-option select shows none. */
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, style, ...props }, ref) => {
    const optionCount = React.Children.toArray(children).filter(
      (child) => React.isValidElement(child) && child.type === "option",
    ).length
    const showArrow = optionCount > 1

    return (
      <select
        ref={ref}
        className={cn(
          "flex h-10 w-full appearance-none rounded-lg border border-input bg-card px-3 py-1 text-body-lg text-foreground sm:text-body",
          "transition-[border-color,box-shadow] duration-[120ms] ease-out",
          "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          "disabled:cursor-not-allowed disabled:opacity-50 dark:[&>option]:bg-card",
          showArrow && "pr-8",
          className,
        )}
        style={
          showArrow
            ? {
                backgroundImage: `url("${CHEVRON_DOWN}")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 0.5rem center",
                backgroundSize: "1rem 1rem",
                ...style,
              }
            : style
        }
        {...props}
      >
        {children}
      </select>
    )
  },
)
Select.displayName = "Select"

export { Select }
