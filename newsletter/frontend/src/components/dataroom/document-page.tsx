"use client";

import { useEffect, useRef, useState } from "react";
import { usePlatform } from "@palettelab/sdk";
import { Spinner } from "../ui/primitives";
import { getDocumentPageImage } from "../../lib/api-client";
import { useT } from "../../lib/i18n";
import type { DocumentPage as PageGeometry } from "../../lib/types";

/**
 * One page of a document, rendered server-side and shown at its true shape.
 *
 * The sheet is sized from the page's real aspect ratio BEFORE the image
 * arrives, so a long document lays out correctly straight away and nothing
 * jumps as pages load. The image itself is only requested once the sheet is
 * near the viewport — a 200-page PDF would otherwise fire 200 renders the
 * moment the viewer opens.
 */
export function DocumentPageSheet({
  docId,
  page,
  scrollRoot,
}: {
  docId: string;
  page: PageGeometry;
  scrollRoot: React.RefObject<HTMLElement | null>;
}) {
  const { apiFetch } = usePlatform();
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      // A screen of lead time, so a page is usually decoded by the time it is
      // scrolled to.
      { root: scrollRoot.current ?? null, rootMargin: "800px 0px" },
    );
    io.observe(host);
    return () => io.disconnect();
  }, [near, scrollRoot]);

  useEffect(() => {
    if (!near) return;
    let url: string | null = null;
    let live = true;
    getDocumentPageImage(apiFetch, docId, page.index)
      .then((u) => {
        url = u;
        if (live) setSrc(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      // Object URLs are not garbage collected on their own.
      if (url) URL.revokeObjectURL(url);
    };
  }, [near, apiFetch, docId, page.index]);

  return (
    <div
      ref={hostRef}
      // `aspect-ratio` from the real page geometry, so the sheet is the right
      // shape at the right size with no image loaded.
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
      className="relative w-full overflow-hidden rounded-lg border border-border bg-white shadow-sm shadow-black/[0.06]"
    >
      {src ? (
        <img
          src={src}
          alt={t("docViewer.pageAlt", { index: page.index + 1 })}
          className="size-full object-contain"
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          {failed ? (
            <p className="px-4 text-center text-sm text-rose-600 dark:text-rose-400">
              {t("docViewer.pageFailed", { index: page.index + 1 })}
            </p>
          ) : (
            <Spinner className="size-5" />
          )}
        </div>
      )}
    </div>
  );
}
