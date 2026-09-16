"use client"

/**
 * The "that page doesn't exist" screen.
 *
 * Lives in a component because it is rendered from two places with different
 * surroundings: `app/not-found.tsx`, which the Palette router renders OUTSIDE
 * the root layout and which therefore has to carry the theme markers itself,
 * and the `[slug]` pages, which are inside the layout and must not repeat them.
 */

import Link from "next/link"
import { FileQuestion } from "lucide-react"

import { AppShell } from "@/components/layout/app-shell"
import { buttonVariants } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export function NotFoundView() {
  const t = useT()
  return (
    <AppShell>
      <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col items-center gap-4 px-gutter py-section text-center">
        <span
          aria-hidden
          className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <FileQuestion className="size-6" />
        </span>
        <h1 className="text-title text-balance">{t("notFound.title")}</h1>
        <p className="max-w-[52ch] text-pretty text-body text-muted-foreground">
          {t("notFound.body")}
        </p>
        <Link href="/" className={cn(buttonVariants({ size: "lg" }), "mt-1")}>
          {t("notFound.back")}
        </Link>
      </div>
    </AppShell>
  )
}
