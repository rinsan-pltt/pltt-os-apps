"use client"

import Link from "next/link"
import { FileQuestion, Receipt } from "lucide-react"

import { EmptyState } from "@/components/layout/empty-state"
import { buttonVariants } from "@/components/ui/button"
import { useT } from "@/lib/i18n"

/**
 * Deliberately does NOT use <AppShell>.
 *
 * The Palette router mounts this route outside the root layout
 * (`notFound: RootNotFound` with no `layouts` — see .palette/dev/
 * palette-app-entry.tsx), so none of the providers exist here. AppShell pulls
 * in the currency picker, which needs SettingsProvider, and the 404 page threw
 * instead of rendering. It gets its own minimal chrome instead.
 */
export default function NotFound() {
  const t = useT()
  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-2.5 sm:px-6">
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-lg text-white"
            style={{ backgroundImage: "var(--erx-brand-gradient)" }}
          >
            <Receipt className="size-4" />
          </span>
          {/* Same split as the shell's BrandMark: the short name is shown, the
              full one is what a screen reader hears. */}
          <span className="text-sm font-semibold tracking-tight" aria-hidden>
            {t("nav.appNameShort")}
          </span>
          <span className="sr-only">{t("nav.appName")}</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6 sm:py-24">
        <EmptyState
          variant="no-results"
          icon={FileQuestion}
          title={t("notFound.title")}
          description={t("notFound.body")}
          action={
            <Link href="/" className={buttonVariants({ size: "lg" })}>
              {t("notFound.back")}
            </Link>
          }
        />
      </main>
    </div>
  )
}
