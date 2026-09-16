"use client";

import { useState } from "react";
import { usePlatform } from "@palettelab/sdk";
import { Button, Input, Spinner } from "../ui/primitives";
import { poseStatus, startPose } from "../../lib/api-client";
import { useT } from "../../lib/i18n";
import type { Mascot } from "../../lib/types";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// `value` is what's actually sent as the generation prompt (kept in English);
// `key` is the translated label shown on the suggestion chip.
const EXAMPLES = [
  { value: "waving hello", key: "poseModal.exampleWave" },
  { value: "thumbs up, excited", key: "poseModal.exampleThumbsUp" },
  { value: "pointing to the right", key: "poseModal.examplePointRight" },
  { value: "thinking pose", key: "poseModal.exampleThinking" },
];

export function PoseModal({
  mascot,
  onClose,
  onDone,
}: {
  mascot: Mascot;
  onClose: () => void;
  onDone: (imageUrl: string) => void;
}) {
  const { apiFetch } = usePlatform();
  const t = useT();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const { poseId } = await startPose(apiFetch, mascot.id, prompt);
      // poll the background job (generation takes ~30-90s)
      for (let i = 0; i < 90; i++) {
        await wait(2000);
        const s = await poseStatus(apiFetch, poseId);
        if (s.status === "ready" && s.imageUrl) {
          onDone(s.imageUrl);
          return;
        }
        if (s.status === "error") {
          setError(
            t("poseModal.generationFailed", { error: s.error || t("poseModal.unknownError") }),
          );
          setBusy(false);
          return;
        }
      }
      setError(t("poseModal.timedOut"));
      setBusy(false);
    } catch {
      setError(t("poseModal.unreachable"));
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-fg">{t("poseModal.title")}</h2>
        <div className="mt-4 flex gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mascot.imageUrl}
            alt={mascot.name}
            className="size-20 shrink-0 rounded-lg bg-surface-2 object-contain"
          />
          <div className="flex-1">
            <Input
              autoFocus
              placeholder={t("poseModal.placeholder")}
              value={prompt}
              disabled={busy}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && generate()}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.value}
                  type="button"
                  disabled={busy}
                  onClick={() => setPrompt(ex.value)}
                  className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-fg-muted transition-colors hover:bg-border hover:text-fg"
                >
                  {t(ex.key)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error ? <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">{error}</p> : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("poseModal.cancel")}
          </Button>
          <Button onClick={generate} disabled={busy}>
            {busy ? (
              <>
                <Spinner /> {t("poseModal.generating")}
              </>
            ) : (
              t("poseModal.generatePose")
            )}
          </Button>
        </div>
        {busy ? (
          <p className="mt-2 text-center text-[11px] text-fg-subtle">
            {t("poseModal.busyHint")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
