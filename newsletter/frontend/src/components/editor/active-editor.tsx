"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { Editor } from "@tiptap/react";

interface Ctx {
  editor: Editor | null;
  setEditor: (e: Editor | null) => void;
  clearIfActive: (e: Editor) => void;
}

const ActiveEditorContext = createContext<Ctx>({
  editor: null,
  setEditor: () => {},
  clearIfActive: () => {},
});

export function ActiveEditorProvider({ children }: { children: React.ReactNode }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const clearIfActive = useCallback((e: Editor) => {
    setEditor((cur) => (cur === e ? null : cur));
  }, []);
  return (
    <ActiveEditorContext.Provider value={{ editor, setEditor, clearIfActive }}>
      {children}
    </ActiveEditorContext.Provider>
  );
}

export const useActiveEditor = () => useContext(ActiveEditorContext);
