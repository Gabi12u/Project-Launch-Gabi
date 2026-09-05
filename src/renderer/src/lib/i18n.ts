import type { LanguageId } from '@shared/types'
import { getState } from './store'

import deCommon from '../locales/de/common'
import deNav from '../locales/de/nav'
import deShell from '../locales/de/shell'
import deInstances from '../locales/de/instances'
import deInstanceDetail from '../locales/de/instanceDetail'
import deInstanceSettings from '../locales/de/instanceSettings'
import deWizard from '../locales/de/wizard'
import deContent from '../locales/de/content'
import deMods from '../locales/de/mods'
import deSettings from '../locales/de/settings'
import deOverlays from '../locales/de/overlays'
import deLib from '../locales/de/lib'

import enCommon from '../locales/en/common'
import enNav from '../locales/en/nav'
import enShell from '../locales/en/shell'
import enInstances from '../locales/en/instances'
import enInstanceDetail from '../locales/en/instanceDetail'
import enInstanceSettings from '../locales/en/instanceSettings'
import enWizard from '../locales/en/wizard'
import enContent from '../locales/en/content'
import enMods from '../locales/en/mods'
import enSettings from '../locales/en/settings'
import enOverlays from '../locales/en/overlays'
import enLib from '../locales/en/lib'

/* ------------------------------------------------------------------ *
 * Translations.
 *
 * One JSON pair per area of the app, German and English side by side, so
 * a missing key is easy to spot by eye. German is the language everything
 * was written in first, so it is also the fallback: an English string that
 * has not been written yet shows the German text instead of a broken key,
 * which is the smaller problem to have while a language is still filling
 * in.
 *
 * A plain function rather than a React hook on purpose. Every view already
 * subscribes to the store through useStore() to read settings, instances
 * and so on, and that subscription is what makes the whole screen re-render
 * when the language changes — the same mechanism that already redraws the
 * app when the theme or the accent colour changes. t() itself only needs to
 * read the current language once per call, so it works equally well inside
 * JSX during render, inside a click handler, or inside a plain helper in
 * lib/actions.ts that is not a component at all.
 * ------------------------------------------------------------------ */

type Dict = Record<string, string>

const NAMESPACES = {
  common: { de: deCommon, en: enCommon },
  nav: { de: deNav, en: enNav },
  shell: { de: deShell, en: enShell },
  instances: { de: deInstances, en: enInstances },
  instanceDetail: { de: deInstanceDetail, en: enInstanceDetail },
  instanceSettings: { de: deInstanceSettings, en: enInstanceSettings },
  wizard: { de: deWizard, en: enWizard },
  content: { de: deContent, en: enContent },
  mods: { de: deMods, en: enMods },
  settings: { de: deSettings, en: enSettings },
  overlays: { de: deOverlays, en: enOverlays },
  lib: { de: deLib, en: enLib }
} satisfies Record<string, { de: Dict; en: Dict }>

export type Namespace = keyof typeof NAMESPACES

export const SUPPORTED_LANGUAGES: { code: LanguageId; label: string }[] = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' }
]

const warned = new Set<string>()

/**
 * Looks a string up and fills in `{name}`-style placeholders.
 *
 * Missing entirely, in both languages, it returns the key itself with the
 * namespace in front (`settings.language`), which is deliberately ugly: it
 * should stand out on screen rather than blend in as though it were the
 * intended text, and it is logged once so it is not the same warning
 * scrolling by on every render.
 */
export function t(
  namespace: Namespace,
  key: string,
  vars?: Record<string, string | number>
): string {
  const language = getState().settings.language
  const table = NAMESPACES[namespace]
  const raw = table?.[language]?.[key] ?? table?.de?.[key]

  if (raw === undefined) {
    const marker = `${namespace}.${key}`
    if (!warned.has(marker)) {
      warned.add(marker)
      // eslint-disable-next-line no-console
      console.warn(`i18n: keine Übersetzung für "${marker}"`)
    }
    return marker
  }

  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  )
}
