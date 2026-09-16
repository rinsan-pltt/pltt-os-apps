"use client";

import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { usePlatform } from "@palettelab/sdk";
import { Button } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { getDocument, uploadFile } from "../../lib/api-client";
import { useT } from "../../lib/i18n";
import type { DocStatus, SourceDocument } from "../../lib/types";

interface Analyzing {
  id: string;
  name: string;
  phase: DocStatus;
  error?: string;
}

const PHASES: { phase: DocStatus; key: string }[] = [
  { phase: "uploaded", key: "uploadZone.phaseUploading" },
  { phase: "parsing", key: "uploadZone.phaseParsing" },
  { phase: "embedding", key: "uploadZone.phaseEmbedding" },
];

// Kept in sync with the backend's allow-list (backend/api/dataroom.py
// _is_supported_document) — anything else either can't be parsed into text
// at all (images, audio, archives, ...) or would silently decode as garbage.
const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".pptx", ".md", ".txt"];
const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(",");

function isSupportedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  if (ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  const mime = file.type.toLowerCase();
  return (
    mime === "application/pdf" ||
    mime.includes("wordprocessingml") ||
    mime.includes("presentationml") ||
    mime.startsWith("text/")
  );
}

const PCT: Record<DocStatus, number> = {
  uploaded: 20,
  parsing: 55,
  embedding: 85,
  ready: 100,
  error: 100,
};

export function UploadZone({
  onAnalyzed,
}: {
  onAnalyzed: (doc: SourceDocument) => void;
}) {
  const { apiFetch } = usePlatform();
  const t = useT();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Analyzing[]>([]);
  const [drag, setDrag] = useState(false);

  function setPhase(id: string, phase: DocStatus) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, phase } : it)));
  }

  async function analyze(file: File) {
    const localId = `up-${Math.random().toString(36).slice(2, 8)}`;
    setItems((prev) => [...prev, { id: localId, name: file.name, phase: "uploaded" }]);
    try {
      // real upload — backend runs extract -> chunk -> embed in the background
      const doc = await uploadFile(apiFetch, file);
      // poll the document's status until the pipeline finishes
      let current = doc;
      for (let i = 0; i < 60 && current.status !== "ready" && current.status !== "error"; i++) {
        await wait(1200);
        current = await getDocument(apiFetch, doc.id);
        setItems((prev) =>
          prev.map((it) => (it.id === localId ? { ...it, phase: current.status } : it)),
        );
      }
      setItems((prev) => prev.filter((it) => it.id !== localId));
      onAnalyzed(current);
    } catch (err) {
      // Surface the backend's reason (api-client forwards HTTPException.detail).
      // A bare "upload failed" hides hosted-only causes — platform storage
      // unavailable, a DB/schema error — that only ever reproduce on the server.
      const reason = err instanceof Error && err.message ? err.message : "";
      setItems((prev) =>
        prev.map((it) =>
          it.id === localId ? { ...it, phase: "error", error: t("uploadZone.uploadFailed") } : it,
        ),
      );
      toast.error(t("uploadZone.uploadFailed"), {
        description: reason ? `${file.name}: ${reason}` : file.name,
      });
      await wait(2500);
      setItems((prev) => prev.filter((it) => it.id !== localId));
    }
  }

  function reject(file: File) {
    toast.error(t("uploadZone.unsupportedTitle"), {
      description: t("uploadZone.unsupportedType", { name: file.name }),
    });
  }

  function handleFiles(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((f) => (isSupportedFile(f) ? analyze(f) : reject(f)));
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={[
          "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
          drag
            ? "border-brand-400 bg-brand-50 dark:bg-brand-400/10"
            : "border-border-strong bg-surface-2",
        ].join(" ")}
      >
        <UploadCloud
          className={["size-6", drag ? "text-brand-500" : "text-fg-subtle"].join(" ")}
          strokeWidth={1.75}
        />
        <p className="text-sm font-medium text-fg">
          {t("uploadZone.dropHint")}
        </p>
        <p className="text-xs text-fg-subtle">
          {t("uploadZone.fileTypesHint")}
        </p>
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          {t("uploadZone.chooseFiles")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((it) => {
            const phaseLabel = t(
              PHASES.find((p) => p.phase === it.phase)?.key ?? "uploadZone.phaseAnalyzing",
            );
            return (
              <li
                key={it.id}
                className={[
                  "rounded-lg border px-3 py-2",
                  it.error
                    ? "border-rose-300 bg-rose-50 dark:border-rose-400/30 dark:bg-rose-400/10"
                    : "border-border bg-surface",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium text-fg">{it.name}</span>
                  <span
                    className={[
                      "shrink-0 text-xs",
                      it.error ? "text-rose-600 dark:text-rose-400" : "text-fg-muted",
                    ].join(" ")}
                  >
                    {it.error ?? `${phaseLabel}…`}
                  </span>
                </div>
                {!it.error ? (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-brand-500 transition-all duration-500"
                      style={{ width: `${PCT[it.phase]}%` }}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
