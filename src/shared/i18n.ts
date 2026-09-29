import type { LanguageId } from './types'

/* ------------------------------------------------------------------ *
 * Language switch.
 *
 * Every user-visible string is written as a German/English pair right where
 * it is used: tr('Spielen', 'Play'). Keeping both next to each other means a
 * new text cannot be added in one language only without it being obvious.
 *
 * The language is fixed for the lifetime of a process. Changing it in the
 * settings relaunches the launcher, so nothing needs to re-render or re-read
 * strings that were already built. Main and renderer each have their own copy
 * of this module and set it once at startup.
 * ------------------------------------------------------------------ */

let current: LanguageId = 'de'

export function setLanguage(language: LanguageId): void {
  current = language === 'en' ? 'en' : 'de'
}

export function getLanguage(): LanguageId {
  return current
}

/** Picks the German or English text for the active language. */
export function tr(de: string, en: string): string {
  return current === 'en' ? en : de
}

/** Locale tag for Intl number and date formatting. */
export function locale(): string {
  return current === 'en' ? 'en-US' : 'de-DE'
}

/** A number with a fixed count of decimals, in the current language's style. */
export function formatNumber(value: number, digits: number): string {
  return value.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export const SUPPORTED_LANGUAGES: { id: LanguageId; label: string }[] = [
  { id: 'de', label: 'Deutsch' },
  { id: 'en', label: 'English' }
]
