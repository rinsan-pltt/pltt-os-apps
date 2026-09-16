"use client";

import { useEffect, useState } from "react";
import { Newspaper, Plus } from "lucide-react";
import { usePlatform } from "@palettelab/sdk";
import { NewsletterCard } from "../newsletters/newsletter-card";
import { buttonClasses, Card, Spinner } from "../ui/primitives";
import { listNewsletters } from "../../lib/api-client";
import { useT } from "../../lib/i18n";
import type { Newsletter } from "../../lib/types";

export function NewslettersView({
  onCreateNewsletter,
  onOpen,
}: {
  onCreateNewsletter: () => void;
  onOpen: (id: string) => void;
}) {
  const { apiFetch } = usePlatform();
  const [items, setItems] = useState<Newsletter[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listNewsletters(apiFetch).then((d) => {
      setItems(d);
      setLoading(false);
    });
  }, [apiFetch]);

  const t = useT();

  return (
    <div className="@container px-6 py-8">
      {/* No create button in this header: the empty state below already offers
          one, and the sidebar's Create tab covers the populated case — so a
          third control calling the same handler earned its removal. */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">
          {t("newsletters.title")}
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          {t("newsletters.subtitle")}
        </p>
      </div>

      {loading ? (
        <div className="mt-12 flex justify-center">
          <Spinner className="size-6" />
        </div>
      ) : items.length === 0 ? (
        <Card className="mt-8 flex flex-col items-center gap-3 p-12 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-surface-2 text-fg-subtle">
            <Newspaper className="size-5" strokeWidth={1.75} />
          </div>
          <p className="text-sm text-fg-muted">{t("newsletters.emptyTitle")}</p>
          <button
            onClick={onCreateNewsletter}
            className={buttonClasses("primary", "md", "mt-1")}
          >
            <Plus className="size-4" strokeWidth={2.25} />
            {t("newsletters.createFirst")}
          </button>
        </Card>
      ) : (
        <div className="mt-6 grid gap-5 @lg:grid-cols-2 @4xl:grid-cols-3 @7xl:grid-cols-4">
          {items.map((nl) => (
            <NewsletterCard key={nl.id} nl={nl} onOpen={() => onOpen(nl.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
