import { usePluginTranslations } from "@palettelab/sdk"

import { translations } from "../translations"

/** Convenience hook returning just the translate function, matching every
 * component's `const t = useT()` call site unchanged. Language now comes
 * from the OS (usePlatform().language) instead of a local toggle/localStorage
 * — see components/shell/app-shell.tsx for the (removed) locale toggle. */
export function useT() {
  const { t } = usePluginTranslations(translations)
  return t
}
