"use client";

import { Check } from "lucide-react";
import { cn } from "../../../lib/cn";
import { useT } from "../../../lib/i18n";

const STEPS = [
  { key: "stepper.sources" },
  { key: "stepper.theme" },
  { key: "stepper.configure" },
  { key: "stepper.generate" },
];

export function Stepper({ current }: { current: number }) {
  const t = useT();
  return (
    <ol className="flex items-center gap-3">
      {STEPS.map((step, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li key={step.key} className="flex items-center gap-3">
            <span
              className={cn(
                "grid size-7 place-items-center rounded-full text-xs font-semibold transition-colors",
                active && "bg-brand-600 text-white shadow-sm shadow-brand-600/25",
                done && "bg-brand-100 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300",
                !active && !done && "bg-surface-2 text-fg-subtle",
              )}
            >
              {done ? <Check className="size-3.5" strokeWidth={2.5} /> : n}
            </span>
            <span
              className={cn(
                "text-sm font-medium",
                active ? "text-fg" : "text-fg-subtle",
              )}
            >
              {t(step.key)}
            </span>
            {i < STEPS.length - 1 ? (
              <span className={cn("h-px w-8", done ? "bg-brand-300 dark:bg-brand-400/40" : "bg-border")} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
