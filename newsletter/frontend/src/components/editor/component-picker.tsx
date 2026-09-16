"use client";

import { useEffect, useState } from "react";
import { Image, Minus, Type } from "lucide-react";
import { usePlatform } from "@palettelab/sdk";
import { Spinner } from "../ui/primitives";
import { listMascots } from "../../lib/api-client";
import { useT } from "../../lib/i18n";
import type { Mascot, OverlayType } from "../../lib/types";

export interface OverlayPayload {
  type: OverlayType;
  imageUrl?: string;
  mascotId?: string; // source mascot id — lets a mascot drop open the pose modal
}

export const OVERLAY_MIME = "application/x-newsletter-overlay";

const COMPONENTS: { type: OverlayType; labelKey: string; icon: typeof Type }[] = [
  { type: "text", labelKey: "picker.text", icon: Type },
  { type: "image", labelKey: "picker.image", icon: Image },
  { type: "line", labelKey: "picker.line", icon: Minus },
];

export function ComponentPicker({
  onPlace,
  onPose,
}: {
  onPlace: (payload: OverlayPayload) => void;
  onPose: (mascot: Mascot) => void;
}) {
  const { apiFetch } = usePlatform();
  const [mascots, setMascots] = useState<Mascot[]>([]);
  const [loading, setLoading] = useState(true);
  const t = useT();

  useEffect(() => {
    listMascots(apiFetch)
      .then(setMascots)
      .finally(() => setLoading(false));
  }, [apiFetch]);

  return (
    <section className="space-y-3 border-t border-border p-4">
      <div>
        <h2 className="mb-2 text-sm font-semibold text-fg">{t("picker.title")}</h2>
        <p className="mb-2 text-[11px] text-fg-subtle">{t("picker.dragHint")}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {COMPONENTS.map((c) => (
          <Tile key={c.type} payload={{ type: c.type }} onPlace={onPlace} label={t(c.labelKey)} Icon={c.icon} />
        ))}
        {mascots.map((m) => (
          <MascotTile key={m.id} mascot={m} onPose={() => onPose(m)} />
        ))}
      </div>
      {loading ? (
        <div className="flex justify-center py-2">
          <Spinner className="size-4" />
        </div>
      ) : mascots.length === 0 ? (
        <p className="text-[11px] text-fg-subtle">
          {t("picker.noMascots")}
        </p>
      ) : null}
    </section>
  );
}

function Tile({
  payload,
  onPlace,
  label,
  Icon,
}: {
  payload: OverlayPayload;
  onPlace: (p: OverlayPayload) => void;
  label: string;
  Icon: typeof Type;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => e.dataTransfer.setData(OVERLAY_MIME, JSON.stringify(payload))}
      onClick={() => onPlace(payload)}
      className="flex flex-col items-center gap-1 rounded-lg border border-border bg-surface py-2 text-fg-muted transition-colors hover:border-brand-300 hover:bg-brand-50 dark:hover:border-brand-400/40 dark:hover:bg-brand-400/10"
    >
      <Icon className="size-4" strokeWidth={2} />
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}

function MascotTile({ mascot, onPose }: { mascot: Mascot; onPose: () => void }) {
  const t = useT();
  const payload: OverlayPayload = {
    type: "mascot",
    imageUrl: mascot.imageUrl,
    mascotId: mascot.id,
  };
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData(OVERLAY_MIME, JSON.stringify(payload))}
      onClick={onPose}
      title={t("picker.mascotTitle", { name: mascot.name })}
      className="flex cursor-grab flex-col items-center gap-1 rounded-lg border border-border bg-surface py-2 transition-colors hover:border-brand-300 hover:bg-brand-50 dark:hover:border-brand-400/40 dark:hover:bg-brand-400/10"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={mascot.imageUrl} alt={mascot.name} draggable={false} className="size-8 object-contain" />
      <span className="max-w-full truncate px-1 text-[11px] font-medium text-fg-muted">{mascot.name}</span>
    </div>
  );
}
