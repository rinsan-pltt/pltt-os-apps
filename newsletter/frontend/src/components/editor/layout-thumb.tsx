import type { LayoutKey } from "../../lib/types";

// Tiny CSS diagram of each layout — no images, no icon library. Opacity-based
// on fg-subtle (rather than a surface/border token) so the bar-vs-box
// brightness relationship (bar = text placeholder, more prominent; box =
// image placeholder, softer) stays consistent in both light and dark mode.
const bar = "rounded-sm bg-fg-subtle/50";
const box = "rounded-sm bg-fg-subtle/25";

export function LayoutThumb({ layout }: { layout: LayoutKey }) {
  const frame = "flex h-12 w-full flex-col gap-1 p-1.5";
  switch (layout) {
    case "title_only":
      return (
        <div className={`${frame} items-center`}>
          <div className={`${bar} h-2 w-3/4`} />
          <div className={`${bar} h-1.5 w-1/2 opacity-60`} />
          <div className="mt-0.5 h-0.5 w-8 rounded-full bg-brand-300" />
        </div>
      );
    case "single_column":
      return (
        <div className={frame}>
          <div className={`${bar} h-1.5 w-2/3`} />
          <div className={`${bar} h-1 w-full opacity-60`} />
          <div className={`${bar} h-1 w-full opacity-60`} />
          <div className={`${bar} h-1 w-5/6 opacity-60`} />
        </div>
      );
    case "two_column":
      return (
        <div className="flex h-12 w-full gap-1 p-1.5">
          <div className="flex w-3/5 flex-col gap-1">
            <div className={`${bar} h-1.5 w-3/4`} />
            <div className={`${bar} h-1 w-full opacity-60`} />
            <div className={`${bar} h-1 w-full opacity-60`} />
          </div>
          <div className={`${box} w-2/5`} />
        </div>
      );
    case "hero_image":
      return (
        <div className={frame}>
          <div className={`${box} h-5 w-full`} />
          <div className={`${bar} h-1.5 w-2/3`} />
          <div className={`${bar} h-1 w-full opacity-60`} />
        </div>
      );
    case "feature_split":
      return (
        <div className="flex h-12 w-full gap-1.5 p-1.5">
          <div className="w-0.5 shrink-0 rounded-full bg-brand-300" />
          <div className="flex flex-1 flex-col gap-1">
            <div className={`${bar} h-1.5 w-3/4`} />
            <div className={`${bar} h-1 w-full opacity-60`} />
            <div className={`${bar} h-1 w-5/6 opacity-60`} />
          </div>
        </div>
      );
    case "sidebar":
      return (
        <div className="flex h-12 w-full gap-1 p-1.5">
          <div className="flex w-2/3 flex-col gap-1">
            <div className={`${bar} h-1 w-full opacity-60`} />
            <div className={`${bar} h-1 w-full opacity-60`} />
            <div className={`${bar} h-1 w-5/6 opacity-60`} />
          </div>
          <div className="w-1/3 rounded-sm bg-brand-200" />
        </div>
      );
    case "gallery":
      return (
        <div className={frame}>
          <div className={`${bar} h-1.5 w-2/3`} />
          <div className={`${bar} h-1 w-1/2 opacity-60`} />
          <div className="grid grid-cols-3 gap-1">
            <div className={`${box} h-5`} />
            <div className={`${box} h-5`} />
            <div className={`${box} h-5`} />
          </div>
        </div>
      );
    case "text_only":
      return (
        <div className={frame}>
          <div className="flex items-center gap-1">
            <div className={`${bar} h-1.5 w-1/2`} />
            <div className="ml-auto h-2 w-1/4 rounded-full bg-fg-subtle/25" />
          </div>
          <div className={`${bar} h-1 w-full opacity-60`} />
          <div className={`${bar} h-1 w-5/6 opacity-60`} />
        </div>
      );
    case "image_right":
      return (
        <div className="flex h-12 w-full gap-1 p-1.5">
          <div className="flex flex-1 flex-col gap-1">
            <div className={`${bar} h-1.5 w-3/4`} />
            <div className={`${bar} h-1 w-full opacity-60`} />
            <div className={`${bar} h-1 w-full opacity-60`} />
          </div>
          <div className={`${box} h-8 w-2/5 self-start`} />
        </div>
      );
    case "six_image_grid":
      return (
        <div className="grid h-12 w-full grid-cols-3 grid-rows-2 gap-1 p-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={box} />
          ))}
        </div>
      );
    case "three_across":
      return (
        <div className={frame}>
          <div className="grid grid-cols-3 gap-1">
            <div className={`${box} h-5`} />
            <div className={`${box} h-5`} />
            <div className={`${box} h-5`} />
          </div>
          <div className={`${bar} h-1 w-full opacity-60`} />
        </div>
      );
    case "image_trio":
      return (
        <div className="flex h-12 w-full gap-1 p-1.5">
          <div className={`${box} w-3/5`} />
          <div className="flex w-2/5 flex-col gap-1">
            <div className={`${box} flex-1`} />
            <div className={`${box} flex-1`} />
          </div>
        </div>
      );
    case "two_image_single_column":
      return (
        <div className="flex h-12 w-full gap-1 p-1.5">
          <div className="flex w-2/5 flex-col gap-1">
            <div className={`${box} flex-1`} />
            <div className={`${box} flex-1`} />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <div className={`${bar} h-1 w-full opacity-60`} />
            <div className={`${bar} h-1 w-full opacity-60`} />
            <div className={`${bar} h-1 w-5/6 opacity-60`} />
          </div>
        </div>
      );
    case "banner_text":
      return (
        <div className="flex h-12 w-full flex-col gap-1 p-1.5">
          <div className="h-2 w-full rounded-sm bg-brand-300" />
          <div className={`${box} h-3 w-full`} />
          <div className="grid grid-cols-2 gap-1">
            <div className={`${bar} h-1 opacity-60`} />
            <div className={`${bar} h-1 opacity-60`} />
          </div>
        </div>
      );
    case "paired_column":
      return (
        <div className="flex h-12 w-full gap-1 p-1.5">
          <div className="flex flex-1 flex-col gap-1 border-r border-border pr-1">
            <div className={`${bar} h-1.5 w-3/4`} />
            <div className={`${bar} h-1 w-full opacity-60`} />
          </div>
          <div className="flex flex-1 flex-col gap-1 pl-1">
            <div className={`${bar} h-1 w-full opacity-60`} />
            <div className={`${bar} h-1 w-full opacity-60`} />
            <div className={`${bar} h-1 w-5/6 opacity-60`} />
          </div>
        </div>
      );
    default:
      return <div className={frame} />;
  }
}
