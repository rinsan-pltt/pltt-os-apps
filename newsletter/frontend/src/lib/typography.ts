// Single source of truth for newsletter typography + page geometry.
// Mirrored verbatim by backend/api/typography.py — keep the numeric values
// and the structure in sync or preview will diverge from PDF.

export interface TypeToken {
  size: number; // px
  weight: number; // 400 / 500 / 700
  leading: number; // unitless ratio (line-height)
  tracking?: number; // em
}

export interface LayoutTypo {
  title: TypeToken;
  summary: TypeToken;
  content: TypeToken;
}

const sectionTitle: TypeToken = {
  size: 18,
  weight: 700,
  leading: 1.375,
  tracking: -0.01,
};

const summary: TypeToken = {
  size: 14,
  weight: 500,
  leading: 1.625,
};

const content: TypeToken = {
  size: 15,
  weight: 400,
  leading: 28 / 15, // tailwind leading-7 = 28px absolute
};

export const TYPO: Record<string, LayoutTypo> = {
  title_only: {
    title: { size: 28, weight: 700, leading: 1.25, tracking: -0.01 },
    summary: { size: 16, weight: 500, leading: 1.625 },
    content,
  },
  hero_image: {
    title: { size: 22, weight: 700, leading: 1.25, tracking: -0.01 },
    summary: { size: 16, weight: 500, leading: 1.625 },
    content,
  },
  paired_column: {
    title: { size: 16, weight: 700, leading: 1.375, tracking: -0.01 },
    summary,
    content,
  },
  single_column: { title: sectionTitle, summary, content },
  two_column: { title: sectionTitle, summary, content },
  feature_split: { title: sectionTitle, summary, content },
  sidebar: { title: sectionTitle, summary, content },
  gallery: { title: sectionTitle, summary, content },
  text_only: { title: sectionTitle, summary, content },
  image_right: { title: sectionTitle, summary, content },
  six_image_grid: { title: sectionTitle, summary, content },
  three_across: { title: sectionTitle, summary, content },
  image_trio: { title: sectionTitle, summary, content },
  two_image_single_column: { title: sectionTitle, summary, content },
  banner_text: { title: sectionTitle, summary, content },
};

export function typoFor(layout: string): LayoutTypo {
  return TYPO[layout] ?? TYPO.single_column;
}

export const PAGE = {
  paddingMM: 12,
  footerMM: 6,
} as const;
