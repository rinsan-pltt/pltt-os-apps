import type { LayoutOption } from "./types";

// Static option lists used by the editor. (All document/newsletter data
// comes from the backend; these are just the pickers.)

export const LAYOUT_OPTIONS: LayoutOption[] = [
  { key: "title_only", label: "Title only", hint: "Section divider / banner" },
  { key: "single_column", label: "Single column", hint: "One narrative block" },
  { key: "two_column", label: "Two column", hint: "Narrative + sidebar 60/40" },
  { key: "hero_image", label: "Hero image", hint: "Big image, lead story" },
  { key: "feature_split", label: "Feature split", hint: "Two features side by side" },
  { key: "sidebar", label: "Sidebar", hint: "Callout / stat box" },
  { key: "gallery", label: "Gallery", hint: "Image grid" },
  { key: "text_only", label: "Text only", hint: "Title + summary pill + body" },
  { key: "image_right", label: "Image right", hint: "Image floated, text wraps" },
  { key: "six_image_grid", label: "6-image grid", hint: "Dense 3×2 image grid" },
  { key: "three_across", label: "Three across", hint: "3 images in a row + text" },
  { key: "image_trio", label: "Image trio", hint: "1 large + 2 stacked images" },
  { key: "two_image_single_column", label: "Two images + text", hint: "Stacked images beside text" },
  { key: "banner_text", label: "Banner", hint: "Accent bar + banner + 2-col text" },
  { key: "paired_column", label: "Paired", hint: "Two-column split" },
];
