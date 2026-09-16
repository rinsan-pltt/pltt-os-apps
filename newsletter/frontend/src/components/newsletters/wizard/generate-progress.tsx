"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { usePlatform } from "@palettelab/sdk";
import { Card, Spinner } from "../../ui/primitives";
import { cn } from "../../../lib/cn";
import { generateNewsletter, retrieve } from "../../../lib/api-client";
import { useT } from "../../../lib/i18n";
import type { GenerateRequest, RetrievedChunk } from "../../../lib/types";

type Phase = "retrieve" | "generate" | "layout" | "done";

const STEPS: { phase: Phase; labelKey: string }[] = [
  { phase: "retrieve", labelKey: "genProgress.stepRetrieve" },
  { phase: "generate", labelKey: "genProgress.stepGenerate" },
  { phase: "layout", labelKey: "genProgress.stepLayout" },
  { phase: "done", labelKey: "genProgress.stepDone" },
];

const ORDER: Phase[] = ["retrieve", "generate", "layout", "done"];

export function GenerateProgress({
  req,
  onComplete,
}: {
  req: GenerateRequest;
  onComplete: (id: string) => void;
}) {
  const { apiFetch } = usePlatform();
  const t = useT();
  const [phase, setPhase] = useState<Phase>("retrieve");
  const [chunks, setChunks] = useState<RetrievedChunk[]>([]);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // guard StrictMode double-run
    started.current = true;

    (async () => {
      const retrieved = await retrieve(apiFetch, req.focusPrompt, req.sourceDocumentIds);
      setChunks(retrieved);
      await wait(700);
      setPhase("generate");
      const nl = await generateNewsletter(apiFetch, req);
      await wait(700);
      setPhase("layout");
      await wait(800);
      setPhase("done");
      await wait(500);
      onComplete(nl.id);
    })();
  }, [req, onComplete, apiFetch]);

  const phaseIdx = ORDER.indexOf(phase);

  return (
    <div className="grid gap-6 @2xl:grid-cols-[1fr_360px]">
      <Card className="p-6">
        <h2 className="text-sm font-semibold text-fg">{t("genProgress.title")}</h2>
        <ol className="mt-4 space-y-3">
          {STEPS.map((s, i) => {
            const done = i < phaseIdx;
            const active = i === phaseIdx;
            return (
              <li key={s.phase} className="flex items-center gap-3">
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-full text-xs",
                    done && "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
                    active && "bg-brand-100 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300",
                    !done && !active && "bg-surface-2 text-fg-subtle",
                  )}
                >
                  {done ? <Check className="size-3.5" strokeWidth={2.5} /> : active ? <Spinner className="size-3.5" /> : i + 1}
                </span>
                <span
                  className={cn(
                    "text-sm",
                    active ? "font-medium text-fg" : "text-fg-muted",
                  )}
                >
                  {t(s.labelKey)}
                </span>
              </li>
            );
          })}
        </ol>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-fg">
          {chunks.length
            ? t("genProgress.retrievedChunksTitle", { count: chunks.length })
            : t("genProgress.retrievedChunksTitleEmpty")}
        </h2>
        {chunks.length === 0 ? (
          <div className="flex justify-center py-8">
            <Spinner className="size-5" />
          </div>
        ) : (
          <ul className="space-y-2">
            {chunks.map((c) => (
              <li
                key={c.chunkId}
                className="rounded-lg border border-border bg-surface-2 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="truncate text-xs font-medium text-fg">
                    {c.documentName}
                  </span>
                  <span className="ml-2 shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 dark:text-brand-300">
                    {c.score.toFixed(2)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{c.snippet}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
