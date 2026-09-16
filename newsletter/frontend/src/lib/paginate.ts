import type { NewsletterBlock } from "./types";

export interface PlacedBlock {
  block: NewsletterBlock;
  /** true when the block is too tall for a fresh page and cannot be split. */
  oversize: boolean;
}

export interface Page {
  index: number;
  isFirst: boolean;
  blocks: PlacedBlock[];
  /** px of vertical space used on this page (excludes cap reserved areas). */
  used: number;
  cap: number;
}

export interface PaginateInput {
  blocks: NewsletterBlock[];
  /** measured heights indexed 1:1 with blocks (after baseline rounding). */
  heights: number[];
  /** available content height on a non-first page, px. */
  pageCap: number;
  /** height reserved on the first page (masthead etc.), px. */
  firstPageReserved: number;
  /** vertical gap between blocks on a page, px. */
  gap: number;
}

export interface PaginateResult {
  pages: Page[];
  /** block ids that overflow even on a fresh page (oversize). */
  oversizeIds: string[];
}

/**
 * Greedy first-fit pagination honoring manual page-break + keep-with-next.
 * Pure: same input -> same output. No DOM access.
 *
 * Rules, evaluated in order for each block:
 *  1. forcePageBreak -> flush current page first (unless empty).
 *  2. keepNext -> ensure the next block's head also fits on the same page;
 *     otherwise flush before placing.
 *  3. plain fit -> if it doesn't fit and the page isn't empty, flush.
 */
export function paginate(input: PaginateInput): PaginateResult {
  const { blocks, heights, pageCap, firstPageReserved, gap } = input;
  const capFor = (pageIndex: number) =>
    pageCap - (pageIndex === 0 ? firstPageReserved : 0);

  const pages: Page[] = [];
  const oversizeIds: string[] = [];
  let cur: PlacedBlock[] = [];
  let used = 0;

  function flush() {
    pages.push({
      index: pages.length,
      isFirst: pages.length === 0,
      blocks: cur,
      used,
      cap: capFor(pages.length),
    });
    cur = [];
    used = 0;
  }

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const h = heights[i] ?? 0;
    const nh = heights[i + 1] ?? 0;
    const cap = capFor(pages.length);

    if (h > cap && !oversizeIds.includes(b.id)) oversizeIds.push(b.id);

    if (b.forcePageBreak && cur.length > 0) flush();

    const capAfterBreak = capFor(pages.length);
    const fits = cur.length === 0 ? h <= capAfterBreak : used + gap + h <= capAfterBreak;

    // keep-with-next: this block + the head of next must sit together.
    const needsRoomForNext = b.keepNext && i + 1 < blocks.length;
    const pairFits =
      cur.length === 0
        ? h + gap + Math.min(nh, GAP_FOR_PEEK) <= capAfterBreak
        : used + gap + h + gap + GAP_FOR_PEEK <= capAfterBreak;

    if (!fits || (needsRoomForNext && !pairFits)) {
      if (cur.length > 0) flush();
    }

    const capNow = capFor(pages.length);
    const oversize = h > capNow;
    used = cur.length === 0 ? h : used + gap + h;
    cur.push({ block: b, oversize });
  }
  flush();

  return { pages, oversizeIds };
}

/** When peeking ahead for keepNext, only the first line of the next block
 * needs to fit. Approximate that as a small fixed head. */
const GAP_FOR_PEEK = 24;
