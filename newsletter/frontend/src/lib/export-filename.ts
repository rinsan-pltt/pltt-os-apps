"use client";

/**
 * Unique, human-readable filenames for newsletter exports.
 *
 * Every export of a given newsletter otherwise lands under the same name, so
 * repeated exports either overwrite each other or pile up as "name (1)",
 * "name (2)" at the browser's discretion. This numbers them explicitly --
 * `August_Report_1.pdf`, `August_Report_2.pdf` -- and the counter is persisted
 * per newsletter so it keeps climbing across sessions instead of resetting to 1
 * and colliding again.
 */

const SEQ_PREFIX = "newsletter:export-seq:";

/** Characters no common filesystem accepts. Spaces are kept here and folded to
 * underscores below; letters from any script are preserved, since titles in
 * this app are routinely non-ASCII. */
const ILLEGAL = /[\\/:*?"<>|]/g;

function slugify(title: string): string {
  const cleaned = title
    .normalize("NFC")
    .replace(ILLEGAL, "")
    .trim()
    .replace(/\s+/g, "_")
    // Trailing dots and underscores are invalid or ugly as a filename stem.
    .replace(/[._]+$/g, "");
  // Leave room for the counter and extension within the usual 255-byte limit.
  return cleaned.slice(0, 80) || "newsletter";
}

/** Next sequence number for this newsletter, persisted where possible.
 *
 * localStorage can be unavailable (sandboxed frame, storage disabled), so fall
 * back to a time-based value that still guarantees a distinct name. */
function nextSequence(newsletterId: string): number {
  const key = `${SEQ_PREFIX}${newsletterId}`;
  try {
    const previous = Number.parseInt(window.localStorage.getItem(key) ?? "0", 10);
    const next = (Number.isFinite(previous) ? previous : 0) + 1;
    window.localStorage.setItem(key, String(next));
    return next;
  } catch {
    // Seconds since the epoch, truncated: short, ascending, and collision-free
    // in practice for one person exporting the same newsletter.
    return Math.floor(Date.now() / 1000) % 100000;
  }
}

/** Filename stem, no extension. e.g. `August_Report_3` */
export function nextExportStem(newsletterId: string, title: string): string {
  return `${slugify(title)}_${nextSequence(newsletterId)}`;
}

/** Full filename. e.g. `August_Report_3.pdf` */
export function nextExportFilename(
  newsletterId: string,
  title: string,
  extension: string,
): string {
  return `${nextExportStem(newsletterId, title)}.${extension}`;
}
