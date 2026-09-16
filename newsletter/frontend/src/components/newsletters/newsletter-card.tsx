"use client";

import { Badge, Card } from "../ui/primitives";
import { shortDate } from "../../lib/format";
import { useT } from "../../lib/i18n";
import type { Newsletter } from "../../lib/types";

export function NewsletterCard({
  nl,
  onOpen,
}: {
  nl: Newsletter;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const palette = nl.themeSnapshot.palette;
  return (
    <button type="button" onClick={() => onOpen(nl.id)} className="group block w-full text-left">
      <Card className="overflow-hidden transition-shadow group-hover:shadow-md group-hover:shadow-black/[0.06]">
        <div
          className="flex h-24 items-end p-4"
          style={{
            background: palette.bg,
            borderBottom: `3px solid ${palette.accent}`,
          }}
        >
          <span
            className="line-clamp-2 text-base font-semibold"
            style={{ color: palette.title }}
          >
            {nl.title}
          </span>
        </div>
        <div className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Badge tone={nl.status === "ready" ? "green" : "amber"}>
              {nl.status === "ready" ? t("nlCard.statusReady") : t("nlCard.statusDraft")}
            </Badge>
            <span className="text-xs text-fg-subtle">
              {t("nlCard.blocksAndSources", {
                blocks: nl.blocks.length,
                sources: nl.sourceDocumentIds.length,
              })}
            </span>
          </div>
          <p className="line-clamp-2 text-sm text-fg-muted">
            {nl.focusPrompt ?? t("nlCard.noFocusSet")}
          </p>
          <p className="text-xs text-fg-subtle">
            {t("nlCard.updatedAt", { date: shortDate(nl.updatedAt) })}
          </p>
        </div>
      </Card>
    </button>
  );
}
