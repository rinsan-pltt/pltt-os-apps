"use client";

// Side-effect import FIRST — installs the window.fetch FormData guard before
// the SDK (and its apiFetch bridge) is loaded, so multipart uploads keep their
// multipart/form-data boundary on the hosted server. See the module for why.
import "./lib/install-fetch-guard";

import { useState } from "react";
import { PluginProvider, type PluginComponentProps } from "@palettelab/sdk";

import "./tailwind.generated.css";

import { AppShell as Shell } from "./components/shell/app-shell";
import { DataroomView } from "./components/views/DataroomView";
import { NewslettersView } from "./components/views/NewslettersView";
import { NewNewsletterView } from "./components/views/NewNewsletterView";
import { EditorView } from "./components/views/EditorView";
import { BrandView } from "./components/views/BrandView";
import { ToastProvider } from "./components/ui/toast";
import { cn } from "./lib/cn";
import { ThemeProvider, useTheme } from "./lib/theme";

type View =
  | { name: "dataroom" }
  | { name: "newsletters" }
  | { name: "newsletters-new"; sourceIds?: string[] }
  | { name: "editor"; id: string }
  | { name: "brand" };

function AppShell() {
  const { theme } = useTheme();
  // Opens on the create wizard: making a newsletter is what the app is for, and
  // the first tab in the sidebar is the one the app should already be on.
  const [view, setView] = useState<View>({ name: "newsletters-new" });

  function navigate(name: string) {
    if (
      name === "dataroom" ||
      name === "newsletters" ||
      name === "newsletters-new" ||
      name === "brand"
    ) {
      setView({ name });
    }
  }

  // The editor is opened FROM the newsletters list and returns to it, so the
  // sidebar keeps "Newsletters" marked current while you are in there — an
  // empty nav would otherwise read as "you are nowhere".
  const activeView = view.name === "editor" ? "newsletters" : view.name;

  return (
    // `h-full` is load-bearing, not cosmetic: it is the middle link in the
    // height chain the shell's `max-h-full` resolves against (see the note in
    // tailwind.css). Without it that clamp is ignored and the shell overflows
    // its container on the server.
    <div className={cn("newsletter-app h-full bg-bg text-fg", theme)} data-theme={theme}>
      <ToastProvider>
        <Shell
          activeView={activeView}
          onNavigate={navigate}
          // The editor's three-column canvas is the one surface that wants the
          // width back, so it opens on the rail unless the user says otherwise.
          dense={view.name === "editor"}
        >
          {view.name === "dataroom" ? (
            <DataroomView
              onCreateNewsletter={(sourceIds) => setView({ name: "newsletters-new", sourceIds })}
            />
          ) : view.name === "newsletters" ? (
            <NewslettersView
              onCreateNewsletter={() => setView({ name: "newsletters-new" })}
              onOpen={(id) => setView({ name: "editor", id })}
            />
          ) : view.name === "newsletters-new" ? (
            <NewNewsletterView
              initialSelected={view.sourceIds}
              onCancel={() => setView({ name: "newsletters" })}
              onComplete={(id) => setView({ name: "editor", id })}
            />
          ) : view.name === "editor" ? (
            <EditorView id={view.id} onBack={() => setView({ name: "newsletters" })} />
          ) : (
            <BrandView />
          )}
        </Shell>
      </ToastProvider>
    </div>
  );
}

export default function NewsletterApp(props: PluginComponentProps) {
  // Re-wrap with the platform object this render actually received, rather
  // than relying solely on whatever ambient PluginProvider the host set up.
  // Matches the reference plugin (palette-creative-labs/frontend/src/index.tsx)
  // — colorMode changes weren't reaching usePlatform() without this, even
  // though language changes (routed separately through
  // usePluginTranslations' own listener) worked fine.
  return (
    <PluginProvider value={props.platform}>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </PluginProvider>
  );
}
