"use client"

import { Link, usePathname } from "@palettelab/sdk/router"
import { useProjectContext } from "@/components/providers/project-context"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbLink,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

const routeMap: Record<string, { parent?: { label: string; href: string }; label: string }> = {
  "/explore": { label: "Explore" },
  "/archive": { label: "Archive" },
}


export function BreadcrumbNav() {
  const pathname = usePathname()
  const { currentProject } = useProjectContext()

  if (pathname === "/") {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage className="uppercase text-xs">Projects</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    )
  }

  // /archive/{id}  → Archive > {name}
  // /projects/{id} → Projects > {name}
  const isProjectArchive = /^\/archive\/[^/]+/.test(pathname)
  if (isProjectArchive || pathname.startsWith("/projects/")) {
    const parentLabel = isProjectArchive ? "Archive" : "Projects"
    const parentHref = isProjectArchive ? "/archive" : "/"

    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem className="hidden md:block">
            <BreadcrumbLink asChild className="uppercase text-xs">
              <Link href={parentHref}>{parentLabel}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem>
            <BreadcrumbPage className="uppercase text-xs">
              {currentProject?.name || "Project"}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    )
  }

  const route = routeMap[pathname]
  if (!route) return null

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {route.parent && (
          <>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink asChild className="uppercase text-xs">
                <Link href={route.parent.href}>{route.parent.label}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
          </>
        )}
        <BreadcrumbItem>
          <BreadcrumbPage className="uppercase text-xs">{route.label}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}
