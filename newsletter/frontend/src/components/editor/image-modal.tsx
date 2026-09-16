"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { usePlatform } from "@palettelab/sdk";
import { Button, Input, Spinner } from "../ui/primitives";
import {
  generateImage,
  imageEditStatus,
  startImageEdit,
  uploadImage,
} from "../../lib/api-client";
import { useT } from "../../lib/i18n";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ImageModal({
  onClose,
  onDone,
  initialUrl,
}: {
  onClose: () => void;
  onDone: (imageUrl: string) => void;
  initialUrl?: string;
}) {
  const { apiFetch } = usePlatform();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Seed with the current image when editing a placed overlay/slot, so a
  // reference-guided edit runs against it instead of starting from scratch.
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(initialUrl ?? null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const { imageUrl } = await uploadImage(apiFetch, file);
      setUploadedUrl(imageUrl);
    } catch {
      setError(t("imageModal.uploadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const { imageUrl } = await generateImage(apiFetch, prompt);
      onDone(imageUrl);
    } catch {
      setError(t("imageModal.generationFailed"));
      setBusy(false);
    }
  }

  async function generateFromReference() {
    if (!uploadedUrl) return;
    setBusy(true);
    setError(null);
    try {
      const { jobId } = await startImageEdit(apiFetch, uploadedUrl, prompt);
      // poll the background job (reference-guided edit takes ~30-90s)
      for (let i = 0; i < 90; i++) {
        await wait(2000);
        const s = await imageEditStatus(apiFetch, jobId);
        if (s.status === "ready" && s.imageUrl) {
          onDone(s.imageUrl);
          return;
        }
        if (s.status === "error") {
          setError(
            t("imageModal.editFailed", { error: s.error || t("imageModal.unknownError") }),
          );
          setBusy(false);
          return;
        }
      }
      setError(t("imageModal.editTimedOut"));
      setBusy(false);
    } catch {
      setError(t("imageModal.editUnreachable"));
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
        <h2 className="text-lg font-semibold text-fg">{t("imageModal.title")}</h2>

        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-1 text-sm font-medium text-fg">{t("imageModal.uploadLabel")}</p>
            {uploadedUrl ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={uploadedUrl}
                  alt=""
                  className="size-14 rounded-lg border border-border object-contain"
                />
                <p className="flex-1 text-xs text-fg-muted">
                  {t("imageModal.uploadedHint")}
                </p>
                <button
                  type="button"
                  onClick={() => setUploadedUrl(null)}
                  disabled={busy}
                  className="text-xs text-fg-subtle hover:underline"
                >
                  {t("imageModal.change")}
                </button>
              </div>
            ) : (
              <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
                <Upload className="size-4" strokeWidth={2} />
                {t("imageModal.chooseFile")}
              </Button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) upload(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </div>

          <div className="border-t border-border pt-4">
            <p className="mb-1 text-sm font-medium text-fg">
              {uploadedUrl ? t("imageModal.useAsReference") : t("imageModal.generateWithAi")}
            </p>
            <div className="flex gap-2">
              <Input
                placeholder={
                  uploadedUrl
                    ? t("imageModal.placeholderTransform")
                    : t("imageModal.placeholderDescribe")
                }
                value={prompt}
                disabled={busy}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || busy || !prompt.trim()) return;
                  if (uploadedUrl) generateFromReference();
                  else generate();
                }}
              />
              <Button
                onClick={uploadedUrl ? generateFromReference : generate}
                disabled={busy || !prompt.trim()}
              >
                {busy ? <Spinner /> : t("imageModal.generate")}
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-fg-subtle">
              {uploadedUrl ? t("imageModal.referenceEditHint") : t("imageModal.generationHint")}
            </p>
          </div>
        </div>

        {error ? <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">{error}</p> : null}

        <div className="mt-5 flex items-center justify-between">
          {uploadedUrl ? (
            <Button variant="outline" onClick={() => onDone(uploadedUrl)} disabled={busy}>
              {t("imageModal.useAsIs")}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("imageModal.cancel")}
          </Button>
        </div>
      </div>
    </div>
  );
}
