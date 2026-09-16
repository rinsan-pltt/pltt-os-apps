import { Extension } from "@tiptap/core";

/** Adds a `fontSize` attribute to the textStyle mark. Set via
 *  editor.chain().setMark("textStyle", { fontSize: "18px" }). */
export const FontSize = Extension.create({
  name: "fontSize",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.fontSize || null,
            renderHTML: (attrs: { fontSize?: string | null }) =>
              attrs.fontSize ? { style: `font-size:${attrs.fontSize}` } : {},
          },
        },
      },
    ];
  },
});

/** Adds a `fontFamily` attribute to the textStyle mark. */
export const FontFamily = Extension.create({
  name: "fontFamily",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.fontFamily || null,
            renderHTML: (attrs: { fontFamily?: string | null }) =>
              attrs.fontFamily ? { style: `font-family:${attrs.fontFamily}` } : {},
          },
        },
      },
    ];
  },
});

/** Adds a `lineHeight` style to paragraph nodes. */
export const LineHeight = Extension.create({
  name: "lineHeight",
  addOptions() {
    return { types: ["paragraph"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.lineHeight || null,
            renderHTML: (attrs: { lineHeight?: string | null }) =>
              attrs.lineHeight ? { style: `line-height:${attrs.lineHeight}` } : {},
          },
        },
      },
    ];
  },
});

export const LINE_HEIGHTS = [
  { label: "Line", value: "" },
  { label: "1.0", value: "1" },
  { label: "1.15", value: "1.15" },
  { label: "1.5", value: "1.5" },
  { label: "2.0", value: "2" },
];

export const FONT_FAMILIES = [
  { label: "Default", value: "" },
  { label: "Sans", value: "ui-sans-serif, system-ui, sans-serif" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "ui-monospace, 'Courier New', monospace" },
];

export const FONT_SIZES = ["12", "14", "16", "18", "20", "24", "28", "32", "40", "48"];
