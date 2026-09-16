import type { NewsletterBlock, LayoutKey } from "./types";

/** Layouts that may be split across pages by re-flowing their text content. */
const SPLITTABLE: ReadonlySet<LayoutKey> = new Set([
  "single_column",
  "feature_split",
  "two_column",
  "sidebar",
]);

export function isSplittable(layout: LayoutKey): boolean {
  return SPLITTABLE.has(layout);
}

/**
 * Split a block's `content` into two halves at a paragraph or sentence
 * boundary so the first half is <= approx `targetChars`. Returns null if no
 * clean split point exists (content too short or unsplittable).
 *
 * Operates on plain text; <mark>/<strong>/<em> tags are stripped from the
 * split index calculation but preserved verbatim in the halves by string
 * slicing.
 */
export function splitContent(content: string, targetChars: number): {
  head: string;
  tail: string;
} | null {
  const text = content.trim();
  if (text.length <= targetChars) return null;

  // Prefer paragraph breaks.
  const paraBreak = text.slice(0, targetChars + 1).lastIndexOf("\n\n");
  if (paraBreak >= Math.floor(targetChars * 0.4)) {
    return {
      head: text.slice(0, paraBreak).trimEnd(),
      tail: text.slice(paraBreak).trimStart(),
    };
  }

  // Then sentence end (. ! ?) followed by space.
  const sentenceRe = /[.!?](?=\s)/g;
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = sentenceRe.exec(text)) && m.index <= targetChars) {
    last = m.index + 1;
  }
  if (last >= Math.floor(targetChars * 0.4)) {
    return {
      head: text.slice(0, last).trimEnd(),
      tail: text.slice(last).trimStart(),
    };
  }

  // Last resort: word boundary.
  const wordBreak = text.slice(0, targetChars + 1).lastIndexOf(" ");
  if (wordBreak >= Math.floor(targetChars * 0.4)) {
    return {
      head: text.slice(0, wordBreak).trimEnd(),
      tail: text.slice(wordBreak).trimStart(),
    };
  }

  return null;
}

/**
 * Given an oversize block, produce a new blocks array where the block is
 * replaced by [head, tail]. The tail is a real NewsletterBlock carrying
 * continuationOf = head.id so the editor treats it as fully editable.
 *
 * Returns null if the block cannot be split (wrong layout or no split point).
 */
export function splitBlock(
  block: NewsletterBlock,
  targetChars: number,
  makeId: () => string,
): { head: NewsletterBlock; tail: NewsletterBlock } | null {
  if (!isSplittable(block.layout)) return null;
  const parts = splitContent(block.content, targetChars);
  if (!parts) return null;

  const head: NewsletterBlock = {
    ...block,
    content: parts.head,
    // head keeps keepNext so it stays attached to its continuation on screen
    keepNext: true,
  };
  const tail: NewsletterBlock = {
    ...block,
    id: makeId(),
    order: block.order + 1,
    content: parts.tail,
    summary: "",
    citations: [],
    continuationOf: block.id,
    keepNext: block.keepNext ?? false,
    forcePageBreak: false,
  };
  return { head, tail };
}

/**
 * Walk the ordered block list and split any block whose content length hints
 * it is oversize. This is a coarse text-level pass; the precise "does it fit"
 * decision still happens in the preview measurer. Idempotent: blocks that are
 * already short are left alone, and existing continuations are skipped.
 */
export function autoSplitOversize(
  blocks: NewsletterBlock[],
  oversizeIds: string[],
  targetChars: number,
  makeId: () => string,
): NewsletterBlock[] | null {
  if (oversizeIds.length === 0) return null;
  const idSet = new Set(oversizeIds);
  let changed = false;
  const out: NewsletterBlock[] = [];
  for (const b of blocks) {
    if (!idSet.has(b.id) || b.continuationOf) {
      out.push(b);
      continue;
    }
    const split = splitBlock(b, targetChars, makeId);
    if (!split) {
      out.push(b);
      continue;
    }
    out.push(split.head, split.tail);
    changed = true;
  }
  if (!changed) return null;
  return out.map((b, i) => ({ ...b, order: i }));
}
