"use client";

import { Card, Field, Input, Select, Textarea } from "../../ui/primitives";
import { useT } from "../../../lib/i18n";

export interface WizardConfig {
  title: string;
  language: string;
  blockCount: number;
  tone: string;
  focusPrompt: string;
}

const LANGUAGES = [
  { value: "en", labelKey: "configure.langEnglish" },
  { value: "ko", labelKey: "configure.langKorean" },
  { value: "es", labelKey: "configure.langSpanish" },
  { value: "fr", labelKey: "configure.langFrench" },
  { value: "de", labelKey: "configure.langGerman" },
  { value: "ja", labelKey: "configure.langJapanese" },
];

const TONES = [
  { value: "Professional", labelKey: "configure.toneProfessional" },
  { value: "Friendly", labelKey: "configure.toneFriendly" },
  { value: "Punchy", labelKey: "configure.tonePunchy" },
  { value: "Formal", labelKey: "configure.toneFormal" },
  { value: "Editorial", labelKey: "configure.toneEditorial" },
];

export function ConfigureForm({
  config,
  onChange,
  sourceCount,
}: {
  config: WizardConfig;
  onChange: (patch: Partial<WizardConfig>) => void;
  sourceCount: number;
}) {
  const t = useT();
  return (
    <div className="grid gap-6 @2xl:grid-cols-[1fr_320px]">
      <div className="@container max-w-2xl space-y-5">
        <Field label={t("configure.titleLabel")}>
          <Input
            value={config.title}
            placeholder={t("configure.titlePlaceholder")}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </Field>

        <Field
          label={t("configure.focusPromptLabel")}
          hint={t("configure.focusPromptHint")}
        >
          <Textarea
            rows={3}
            value={config.focusPrompt}
            placeholder={t("configure.focusPromptPlaceholder")}
            onChange={(e) => onChange({ focusPrompt: e.target.value })}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 @xs:grid-cols-2">
          <Field label={t("configure.languageLabel")}>
            <Select
              value={config.language}
              onChange={(e) => onChange({ language: e.target.value })}
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {t(l.labelKey)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t("configure.toneLabel")}>
            <Select
              value={config.tone}
              onChange={(e) => onChange({ tone: e.target.value })}
            >
              {TONES.map((tone) => (
                <option key={tone.value} value={tone.value}>
                  {t(tone.labelKey)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label={t("configure.blocksLabel", { count: config.blockCount })}
          hint={t("configure.blocksHint")}
        >
          <input
            type="range"
            min={3}
            max={10}
            value={config.blockCount}
            onChange={(e) => onChange({ blockCount: Number(e.target.value) })}
            className="w-full accent-brand-600"
          />
        </Field>
      </div>

      <aside className="@2xl:sticky @2xl:top-6 @2xl:self-start">
        <Card className="space-y-3 p-4 text-sm">
          <h2 className="text-sm font-semibold text-fg">{t("configure.summaryTitle")}</h2>
          <Row k={t("configure.summarySourcesSelected")} v={String(sourceCount)} />
          <Row k={t("configure.summaryBlocks")} v={String(config.blockCount)} />
          <Row k={t("configure.languageLabel")} v={config.language.toUpperCase()} />
          <Row k={t("configure.toneLabel")} v={config.tone} />
          <p className="border-t border-border pt-3 text-xs text-fg-subtle">
            {t("configure.summaryFootnote")}
          </p>
        </Card>
      </aside>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-fg-muted">{k}</span>
      <span className="font-medium text-fg">{v}</span>
    </div>
  );
}
