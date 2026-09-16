"use client"

import { cn } from "@/lib/utils"
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavMain({
  items,
}: {
  items: {
    title: string
    icon: React.ElementType
    isActive?: boolean
    onClick?: () => void
  }[]
}) {
  return (
    <SidebarGroup className="p-0 py-3 border-b border">
      <SidebarMenu className="gap-0">
        {items.map((item) => (
          <SidebarMenuItem key={item.title}>
            <SidebarMenuButton
              onClick={item.onClick}
              tooltip={item.title}
              className={cn(
                "cursor-pointer uppercase text-xs border-l-2 border-l-transparent transition-[padding] duration-200",
                // collapsed: full-width row with centered icon (no right gap)
                "group-data-[collapsible=icon]:!size-auto group-data-[collapsible=icon]:!h-8 group-data-[collapsible=icon]:!w-full group-data-[collapsible=icon]:!justify-center group-data-[collapsible=icon]:!px-0",
                item.isActive
                  ? // extra left padding indents the icon when selected, for a "selected" feel.
                    // Use the themed sidebar-accent token (light grey in light mode, near-black
                    // in dark mode) rather than a hardcoded neutral + `dark:` variant: the
                    // dark-variant utilities compile to `:is(.dark *)`, whose `.dark` class does
                    // NOT take effect in the scoped OS build, so the active row fell back to its
                    // light hardcoded neutral (a white row on the dark sidebar). This token is
                    // themed via the app-root data-* attributes, so it resolves correctly in
                    // every runtime.
                    "border-l-primary/50 font-semibold pl-4 !bg-sidebar-accent"
                  : "hover:border-l-border hover:bg-secondary"
              )}
            >
              <item.icon strokeWidth={1.5} />
              <span className="group-data-[collapsible=icon]:hidden">{item.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
