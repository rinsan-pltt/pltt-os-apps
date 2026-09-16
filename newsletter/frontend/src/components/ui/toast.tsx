"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "../../lib/cn";

type ToastTone = "error" | "success" | "info";

interface ToastOptions {
  description?: string;
}

interface ToastItem extends ToastOptions {
  id: string;
  title: string;
  tone: ToastTone;
}

interface ToastContextValue {
  error: (title: string, options?: ToastOptions) => void;
  success: (title: string, options?: ToastOptions) => void;
  info: (title: string, options?: ToastOptions) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const TONE_ICON: Record<ToastTone, typeof AlertTriangle> = {
  error: AlertTriangle,
  success: CheckCircle2,
  info: Info,
};

const TONE_CLASSES: Record<ToastTone, string> = {
  error:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/25 dark:bg-rose-950/90 dark:text-rose-300",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-950/90 dark:text-emerald-300",
  info: "border-border bg-surface text-fg",
};

const DURATION_MS = 5000;

/** App-wide toast/popup notifications — bottom-right, auto-dismissing, rich
 * colors by tone: same shape as the reference plugin's sonner-based Toaster
 * (position="bottom-right" richColors), reimplemented without the extra
 * dependency since this app already hand-rolls its other UI primitives (see
 * ui/confirm-modal.tsx). Mount once near the app root; call useToast()
 * anywhere beneath it. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = React.useCallback(
    (tone: ToastTone, title: string, options?: ToastOptions) => {
      const id = `toast-${Math.random().toString(36).slice(2, 9)}`;
      setItems((prev) => [...prev, { id, title, tone, description: options?.description }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATION_MS),
      );
    },
    [dismiss],
  );

  const value = React.useMemo<ToastContextValue>(
    () => ({
      error: (title, options) => push("error", title, options),
      success: (title, options) => push("success", title, options),
      info: (title, options) => push("info", title, options),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end">
        {items.map((it) => {
          const Icon = TONE_ICON[it.tone];
          return (
            <div
              key={it.id}
              role="alert"
              className={cn(
                "toast-in pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-lg shadow-black/10 backdrop-blur-sm",
                TONE_CLASSES[it.tone],
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
              <div className="flex-1 space-y-0.5">
                <p className="font-medium">{it.title}</p>
                {it.description ? <p className="opacity-80">{it.description}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(it.id)}
                className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
              >
                <X className="size-3.5" strokeWidth={2.25} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a <ToastProvider>");
  return ctx;
}
