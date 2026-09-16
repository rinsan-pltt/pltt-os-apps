import type { DocStatus } from "./types";

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
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
