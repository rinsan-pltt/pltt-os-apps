"use client";

import { createContext, useContext } from "react";
import { DEFAULT_HIGHLIGHTS } from "../../lib/highlights";

const Ctx = createContext<string[]>(DEFAULT_HIGHLIGHTS);

export function ThemeHighlightsProvider({
  value,
  children,
}: {
  value: string[] | undefined;
  children: React.ReactNode;
}) {
  return (
    <Ctx.Provider value={value && value.length ? value : DEFAULT_HIGHLIGHTS}>
      {children}
    </Ctx.Provider>
  );
}

export function useThemeHighlights(): string[] {
  return useContext(Ctx);
}
