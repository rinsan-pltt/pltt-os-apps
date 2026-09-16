"use client";

/**
 * Theme provider driven by the Palette OS appearance — no in-app toggle.
 *
 * Mirrors palette-creative-labs/frontend/components/providers/theme-provider.tsx:
 * Palette OS reports the active light/dark appearance through
 * `usePlatform().colorMode` and updates it live when the OS switches. This
 * provider mirrors that value into the app and exposes `useTheme(): { theme,
 * setTheme }`. For hosts that don't send `colorMode` (or the local `pltt dev`
 * simulator, where `setColorMode` doesn't echo back), it falls back to the
 * browser's `prefers-color-scheme`.
 *
 * `setTheme` has no visible button anywhere in the app — appearance is meant
 * to be controlled from Palette OS, exactly like the reference plugin. It's
 * only reachable via the "d" keyboard shortcut below, which exists purely so
 * theming is still testable in the local dev simulator (where there's no OS
 * chrome to flip `colorMode` from).
 */

import * as React from "react";
import { usePlatform } from "@palettelab/sdk";

type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined);

function prefersColorScheme(): Theme {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const platform = usePlatform();

  const [fallback, setFallback] = React.useState<Theme>(prefersColorScheme);

  React.useEffect(() => {
    let media: MediaQueryList;
    try {
      media = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    const onChange = () => setFallback(media.matches ? "dark" : "light");
    onChange();
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  // Local override (e.g. the nav toggle). Takes precedence over the OS value
  // so the toggle works even in the dev simulator, where `setColorMode` does
  // not echo back into `platform.colorMode`. In Palette OS, `setColorMode`
  // drives a real OS appearance change that flows back through `colorMode`,
  // so the two stay consistent there.
  const [override, setOverride] = React.useState<Theme | null>(null);

  const theme: Theme = override ?? platform.colorMode ?? fallback;
  const setTheme = React.useCallback(
    (next: Theme) => {
      setOverride(next);
      platform.setColorMode?.(next);
    },
    [platform],
  );

  // Press "d" to toggle light/dark — dev-only fallback (see file docstring).
  // Ignored while typing in a field or when combined with a modifier, so it
  // never fights with text entry or shortcuts.
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "d" && e.key !== "D") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      e.preventDefault();
      setTheme(theme === "dark" ? "light" : "dark");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [theme, setTheme]);

  const value = React.useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a <ThemeProvider>");
  }
  return ctx;
}
