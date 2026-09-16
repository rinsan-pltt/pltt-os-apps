"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Sparkles, X } from "lucide-react";
import { Stepper } from "../newsletters/wizard/stepper";
import { SourcePicker } from "../newsletters/wizard/source-picker";
import { ThemePicker } from "../newsletters/wizard/theme-picker";
import { ConfigureForm, type WizardConfig } from "../newsletters/wizard/configure-form";
import { GenerateProgress } from "../newsletters/wizard/generate-progress";
import { Button } from "../ui/primitives";
import { useT } from "../../lib/i18n";
import type { BrandTheme, GenerateRequest, SourceDocument } from "../../lib/types";

export function NewNewsletterView({
  initialSelected,
  onCancel,
  onComplete,
}: {
  /** Documents ticked in the Dataroom before opening the wizard. They arrive
   *  already selected on step 1 and stay editable there. */
  initialSelected?: string[];
  onCancel: () => void;
  onComplete: (id: string) => void;
}) {
  const t = useT();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [docs, setDocs] = useState<SourceDocument[]>([]);
  // Seeded once, from the initial render's prop: this is the wizard's own
  // working set from then on, so later prop changes must not yank a source out
  // from under someone mid-flow.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(Array.isArray(initialSelected) ? initialSelected : []),
  );
  const [themes, setThemes] = useState<BrandTheme[]>([]);
  const [themeId, setThemeId] = useState<string | null>(null);
  const [config, setConfig] = useState<WizardConfig>({
    title: "",
    language: "en",
    blockCount: 5,
    tone: "Professional",
    focusPrompt: "",
  });

  const toggle = useCallback((id: string, on?: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const shouldOn = on ?? !next.has(id);
      if (shouldOn) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const setDocsFn = useCallback(
    (updater: (prev: SourceDocument[]) => SourceDocument[]) => setDocs(updater),
    [],
  );

  const req: GenerateRequest = useMemo(
    () => ({
      title: config.title || "Untitled newsletter",
      language: config.language,
      blockCount: config.blockCount,
      tone: config.tone,
      focusPrompt: config.focusPrompt,
      sourceDocumentIds: Array.from(selected),
      brandThemeId: themeId ?? "",
    }),
    [config, selected, themeId],
  );

  const canNext = step === 1 ? selected.size > 0 : step === 2 ? !!themeId : true;

  return (
    <div className="@container px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">
          {t("wizard.title")}
        </h1>
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
        >
          <X className="size-4" strokeWidth={2} />
          {t("wizard.cancel")}
        </button>
      </div>

      <div className="mt-6 overflow-x-auto">
        <Stepper current={step} />
      </div>

      <div className="mt-8">
        {step === 1 ? (
          <SourcePicker
            docs={docs}
            setDocs={setDocsFn}
            selected={selected}
            toggle={toggle}
          />
        ) : step === 2 ? (
          <ThemePicker
            themes={themes}
            setThemes={setThemes}
            selectedId={themeId}
            onSelect={setThemeId}
          />
        ) : step === 3 ? (
          <ConfigureForm
            config={config}
            onChange={(patch) => setConfig((c) => ({ ...c, ...patch }))}
            sourceCount={selected.size}
          />
        ) : (
          <GenerateProgress req={req} onComplete={onComplete} />
        )}
      </div>

      {step !== 4 ? (
        <div className="mt-8 flex items-center justify-between border-t border-border pt-5">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
            disabled={step === 1}
          >
            <ArrowLeft className="size-4" strokeWidth={2} />
            {t("wizard.back")}
          </Button>
          <div className="flex items-center gap-3">
            {step === 1 ? (
              <span className="text-sm text-fg-subtle">
                {t("wizard.sourcesSelected", { count: selected.size })}
              </span>
            ) : null}
            <Button
              onClick={() => setStep((s) => ((s + 1) as 2 | 3 | 4))}
              disabled={!canNext}
            >
              {step === 3 ? t("wizard.generateCta") : t("wizard.nextCta")}
              {step === 3 ? <Sparkles className="size-4" strokeWidth={2} /> : <ArrowRight className="size-4" strokeWidth={2} />}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
