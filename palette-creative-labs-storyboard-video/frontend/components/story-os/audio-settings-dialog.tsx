"use client"

// Optional-settings dialog for the two ElevenLabs-backed audio modes
// (music / voiceover_music) — same centered AlertDialog treatment as the
// scene-delete confirmation, but a settings form (Save/Cancel) instead of a
// destructive confirm.

import * as React from "react"
import { IconInfoCircle } from "@tabler/icons-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { AudioMode } from "@/components/providers/story-video-context"
import { usePosT, type PosKey } from "./i18n"
import { SectionLabel } from "./ui"

// Shared display label for the Audio DropChip, used by both Home (before a
// session exists) and Brief (editing an existing one).
export function audioLabel(mode: AudioMode, t: (key: PosKey) => string): string {
  switch (mode) {
    case "silent":
      return t("audioSilent")
    case "music":
      return t("audioMusic")
    case "voiceover_music":
      return t("audioVoiceoverMusic")
    default:
      return t("audioGenerated")
  }
}

// A few well-known ElevenLabs premade voices — enough choice for "optional
// settings" without building a full voice-library browser.
export const NARRATION_VOICE_PRESETS = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh" },
]

export interface AudioSettingsValue {
  musicPrompt: string
  narrationText: string
  narrationVoiceId: string
  narrationLanguage: string
  captionsEnabled: boolean
}

export const NARRATION_LANGUAGES = [
  { value: "ko", labelKey: "langKorean" },
  { value: "en", labelKey: "langEnglish" },
] as const

// This app is built for Korean users first — narration defaults to Korean
// rather than English.
export const DEFAULT_NARRATION_LANGUAGE = "ko"

const inputClass =
  "w-full resize-none text-xs leading-relaxed text-[var(--pos-t1)] bg-[var(--pos-s3)] border border-[var(--pos-b2)] rounded-[6px] p-2.5 outline-none focus:border-[var(--pos-vio)]"

export function AudioSettingsDialog({
  open,
  onOpenChange,
  mode,
  initial,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: AudioMode
  initial: AudioSettingsValue
  onSave: (value: AudioSettingsValue) => void
}) {
  const { t } = usePosT()
  const [musicPrompt, setMusicPrompt] = React.useState(initial.musicPrompt)
  const [narrationText, setNarrationText] = React.useState(initial.narrationText)
  const [voiceId, setVoiceId] = React.useState(initial.narrationVoiceId || NARRATION_VOICE_PRESETS[0].id)
  const [language, setLanguage] = React.useState(initial.narrationLanguage || DEFAULT_NARRATION_LANGUAGE)
  // Captions default ON for voiceover_music — ticking it off falls back to
  // plain voiceover + music with no burned-in text.
  const [captionsEnabled, setCaptionsEnabled] = React.useState(initial.captionsEnabled ?? true)

  // Re-sync to the caller's current values every time the dialog opens —
  // editing settings again should start from what's actually saved, not a
  // stale draft left over from a previous open/cancel.
  React.useEffect(() => {
    if (!open) return
    setMusicPrompt(initial.musicPrompt)
    setNarrationText(initial.narrationText)
    setVoiceId(initial.narrationVoiceId || NARRATION_VOICE_PRESETS[0].id)
    setLanguage(initial.narrationLanguage || DEFAULT_NARRATION_LANGUAGE)
    setCaptionsEnabled(initial.captionsEnabled ?? true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const needsMusic = mode === "music" || mode === "voiceover_music"
  const needsNarration = mode === "voiceover_music"
  const titleKey = mode === "music" ? "audioSettingsMusicTitle" : "audioSettingsVoiceoverTitle"

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="uppercase tracking-widest text-sm">{t(titleKey)}</AlertDialogTitle>
          <AlertDialogDescription>{t("audioSettingsHint")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3.5 max-h-[60vh] overflow-y-auto">
          {needsMusic && (
            <div>
              <SectionLabel className="mb-1">{t("musicPromptLabel")}</SectionLabel>
              <textarea
                value={musicPrompt}
                onChange={(e) => setMusicPrompt(e.target.value)}
                placeholder={t("musicPromptPlaceholder")}
                rows={3}
                className={inputClass}
              />
            </div>
          )}
          {needsNarration && (
            <>
              <div>
                <SectionLabel className="mb-1">{t("narrationTextLabel")}</SectionLabel>
                <textarea
                  value={narrationText}
                  onChange={(e) => setNarrationText(e.target.value)}
                  placeholder={t("narrationTextPlaceholder")}
                  rows={6}
                  className={inputClass}
                />
              </div>
              <div>
                <SectionLabel className="mb-1">{t("narrationVoiceLabel")}</SectionLabel>
                <select
                  value={voiceId}
                  onChange={(e) => setVoiceId(e.target.value)}
                  className={`${inputClass} cursor-pointer`}
                >
                  {NARRATION_VOICE_PRESETS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <SectionLabel className="mb-1">{t("narrationLanguageLabel")}</SectionLabel>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className={`${inputClass} cursor-pointer`}
                >
                  {NARRATION_LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {t(l.labelKey)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={captionsEnabled}
                    onChange={(e) => setCaptionsEnabled(e.target.checked)}
                    className="size-3.5 accent-[var(--pos-vio)] cursor-pointer"
                  />
                  <span className="text-xs text-[var(--pos-t1)]">{t("includeCaptions")}</span>
                </label>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      title={t("captionsAutoNote")}
                      className="text-[var(--pos-t3)] hover:text-[var(--pos-t1)] cursor-pointer flex items-center"
                    >
                      <IconInfoCircle className="size-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 bg-[var(--pos-s2)] border-[var(--pos-b2)] p-2.5" align="start">
                    <p className="text-[11px] leading-relaxed text-[var(--pos-t3)]">{t("captionsAutoNote")}</p>
                  </PopoverContent>
                </Popover>
              </div>
            </>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              onSave({ musicPrompt, narrationText, narrationVoiceId: voiceId, narrationLanguage: language, captionsEnabled })
            }
          >
            {t("save")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
