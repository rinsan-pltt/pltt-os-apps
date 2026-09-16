"use client";

import { cn } from "../../lib/cn";
import { useT } from "../../lib/i18n";

export function Spinner({ className }: { className?: string }) {
  const t = useT();
  return (
    <span
      role="status"
      aria-label={t("common.loading")}
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2 border-border-strong border-t-brand-600",
        className,
      )}
    />
  );
}
