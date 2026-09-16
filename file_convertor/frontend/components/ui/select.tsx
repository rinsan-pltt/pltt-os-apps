import * as React from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

/** Styled native select — no portal/popper dependencies needed here.
 *
 *  The native dropdown arrow is removed by `appearance-none`, so we render our
 *  own chevron. It only appears when there's an actual choice to make (more
 *  than one <option>); a single-option select shows no arrow. */
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => {
    const optionCount = React.Children.toArray(children).filter(
      (child) => React.isValidElement(child) && child.type === "option",
    ).length
    const showChevron = optionCount > 1

    return (
      <div className="relative w-full">
        <select
          ref={ref}
          className={cn(
            "flex h-10 w-full appearance-none rounded-lg border border-input bg-card px-3 py-1 text-body shadow-[var(--dt-shadow-sm)] sm:text-ui",
            "transition-[border-color,box-shadow] duration-[var(--dt-dur-instant)] ease-out",
            showChevron && "pr-8",
            "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            // `dark:[&>option]:bg-card` used to live here to stop the native
            // dropdown rendering light inside the dark theme. Declaring
            // `color-scheme` per palette in globals.css makes the browser do
            // that itself, for the popup, scrollbars and all.
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        {showChevron && (
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
        )}
      </div>
    )
  },
)
Select.displayName = "Select"

export { Select }
