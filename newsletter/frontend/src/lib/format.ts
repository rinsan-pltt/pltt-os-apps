import { usePlatform } from "@palettelab/sdk";
import type { DocStatus } from "./types";

const LOCALE_BY_LANGUAGE: Record<string, string> = {
  en: "en-US",
  ko: "ko-KR",
  ja: "ja-JP",
};

/** Map a Palette OS language tag (e.g. "ja-JP", "ko") to a date locale. */
export function localeForLanguage(language?: string | null): string {
  const base = (language ?? "").toLowerCase().split("-")[0];
  return LOCALE_BY_LANGUAGE[base] ?? "en-US";
}

/** BCP-47 locale for date formatting, following the Palette OS language. */
export function useLocale(): string {
  const platform = usePlatform() as unknown as { language?: string | null };
  return localeForLanguage(platform?.language);
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function shortDate(iso: string, locale = "en-US"): string {
  try {
    return new Date(iso).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function fileKind(mime: string): string {
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("word")) return "DOCX";
  if (mime.includes("presentation")) return "PPTX";
  if (mime.includes("markdown")) return "MD";
  if (mime.includes("sheet")) return "XLSX";
  return "FILE";
}

export function statusTone(
  status: DocStatus,
): "slate" | "green" | "amber" | "red" | "blue" {
  switch (status) {
    case "ready":
      return "green";
    case "error":
      return "red";
    case "embedding":
    case "parsing":
      return "amber";
    default:
      return "slate";
  }
}

/** Render <mark> highlight markup as sanitized-ish HTML for preview. */
export function renderMarks(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;mark&gt;/g, '<mark class="bg-brand-100 text-brand-800 rounded px-0.5">')
    .replace(/&lt;\/mark&gt;/g, "</mark>")
    .replace(/&lt;strong&gt;/g, "<strong>")
    .replace(/&lt;\/strong&gt;/g, "</strong>")
    .replace(/&lt;em&gt;/g, "<em>")
    .replace(/&lt;\/em&gt;/g, "</em>");
}
