"use client"

import * as React from "react"

import { AppShell } from "@/components/layout/app-shell"
import { ChatPanel } from "@/components/layout/chat-panel"
import { PageHeader } from "@/components/layout/page-header"
import { useCategories } from "@/components/categories-provider"
import { useSettings } from "@/components/settings-provider"
import { Card } from "@/components/ui/card"
import { useChat } from "@/hooks/use-chat"
import { useT } from "@/lib/i18n"

export default function ChatPage() {
  const t = useT()
  const { refresh: refreshCategories } = useCategories()
  const { refresh: refreshSettings } = useSettings()

  // The assistant writes through the same endpoints the screens use, so
  // anything the app caches app-wide is stale the moment it does. Expense
  // lists are fetched per page and reload on navigation; the category set and
  // the base currency live in providers that load once, so they need telling.
  const onChanged = React.useCallback(() => {
    void refreshCategories()
    void refreshSettings()
  }, [refreshCategories, refreshSettings])

  const { turns, sending, preparing, downloading, send, confirmAction, download, clear } = useChat({
    onChanged,
  })

  return (
    <AppShell>
      {/* A chat is the one page whose content must NOT grow the scroller: the
          composer belongs at the bottom of the viewport and the transcript
          scrolls behind it. `h-full` takes exactly the working area's height
          (AppShell gives <main> a definite one), and `min-h-[30rem]` is the
          floor below which <main>'s own overflow takes over — the same
          "responsive to a limit, then scroll" contract as every other page. */}
      <div className="flex h-full min-h-[30rem] w-full min-w-72 flex-col gap-block px-gutter py-page-y">
        <PageHeader title={t("chat.title")} description={t("chat.subtitle")} className="shrink-0" />
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ChatPanel
            turns={turns}
            sending={sending}
            preparing={preparing}
            downloading={downloading}
            onSend={send}
            onAnswer={confirmAction}
            onDownload={download}
            onClear={clear}
          />
        </Card>
      </div>
    </AppShell>
  )
}
