"use client"

import { usePluginTranslations } from "@palettelab/sdk"

import { translations } from "./translations"
import type { Tool, ToolOption } from "./tools"
import type { Workflow } from "./workflows"

/**
 * Translate function bound to this app's resources. The active language follows
 * Palette OS (`usePlatform().language`); there is no in-app toggle. Signature:
 * `t(key, values?, defaultValue?)` — a missing key falls back to `en`, then to
 * `defaultValue`, then to the key itself.
 */
export function useT() {
  const { t } = usePluginTranslations(translations)
  return t
}

/**
 * Localized accessors for the tool/workflow registry. These pass the existing
 * English string (from lib/tools.ts / lib/workflows.ts) as the fallback, so any
 * entry not yet translated simply shows the English original.
 */
export function useRegistryText() {
  const t = useT()
  return {
    /** Localized category name. */
    category: (category: string) => t(`categories.${category}`, undefined, category),
    /** Localized tool title. */
    toolTitle: (tool: Tool) => t(`tools.${tool.slug}.title`, undefined, tool.title),
    /** Localized tool description. */
    toolDescription: (tool: Tool) => t(`tools.${tool.slug}.description`, undefined, tool.description),
    /** Localized primary action-button label. */
    toolAction: (tool: Tool) => t(`tools.${tool.slug}.actionLabel`, undefined, tool.actionLabel),
    /** Localized tool badge. These were rendered raw, so "New!" stayed English
     *  in every locale. Keyed by the English text, like `stepLabel`. */
    badge: (badge: string) => t(`badges.${badge}`, undefined, badge),
    /** Localized option label. */
    optLabel: (slug: string, opt: ToolOption) => t(`to.${slug}.${opt.name}`, undefined, opt.label),
    /** Localized option placeholder (text/password options only). */
    optPlaceholder: (slug: string, name: string, placeholder: string) =>
      t(`tp.${slug}.${name}`, undefined, placeholder),
    /** Localized select-choice label. */
    optChoice: (slug: string, name: string, value: string, label: string) =>
      t(`tc.${slug}.${name}.${value}`, undefined, label),
    /** Localized built-in-workflow title (custom workflows keep their stored title). */
    workflowTitle: (wf: Workflow) => t(`wf.${wf.slug}.title`, undefined, wf.title),
    /** Localized built-in-workflow description. */
    workflowDescription: (wf: Workflow) => t(`wf.${wf.slug}.description`, undefined, wf.description),
    /** Localized workflow step chip label. */
    stepLabel: (label: string) => t(`wfStep.${label}`, undefined, label),
    /** Localized workflow prompt-option label. */
    wfOptLabel: (wfSlug: string, stepIndex: number, name: string, label: string) =>
      t(`wo.${wfSlug}.${stepIndex}.${name}`, undefined, label),
    /** Localized workflow prompt-option placeholder. */
    wfOptPlaceholder: (wfSlug: string, stepIndex: number, name: string, placeholder: string) =>
      t(`wp.${wfSlug}.${stepIndex}.${name}`, undefined, placeholder),
    /** Localized language name (translate workspace). */
    language: (name: string) => t(`langs.${name}`, undefined, name),
  }
}
