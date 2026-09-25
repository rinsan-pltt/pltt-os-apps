"use client"

/** `/category/<slug>` — the section workspace: one upload, every tool in the
 *  section beside it.
 *
 *  A route rather than `/?cat=<slug>`, because a query string does not survive
 *  an in-app click inside a Palette OS window; see `toolHref` in lib/tools.ts. */

import { useParams } from "next/navigation"

import { CategoryWorkspace } from "@/components/layout/category-workspace"
import { NotFoundView } from "@/components/layout/not-found-view"
import { categoryFromParam } from "@/lib/tools"

export default function CategoryPage() {
  const params = useParams<{ slug: string }>()
  const category = categoryFromParam(String(params?.slug ?? ""))
  if (!category) return <NotFoundView />
  return <CategoryWorkspace category={category} />
}
