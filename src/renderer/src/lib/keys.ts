import { tr } from '@shared/i18n'

/**
 * The shortcuts themselves accept Ctrl and Cmd alike (App.tsx), but the
 * labels named Ctrl everywhere, which a Mac keyboard reserves for something
 * else. The renderer is sandboxed, so the platform comes from the user agent,
 * which Chromium on macOS always reports as "Macintosh".
 */
const isMac = /Mac/.test(navigator.userAgent)

/** A shortcut label for a key hint: "⌘ K" on macOS, "Strg K" elsewhere. */
export function shortcut(key: string): string {
  return isMac ? `⌘ ${key}` : tr(`Strg ${key}`, `Ctrl ${key}`)
}

/** The same shortcut inside running text: "Cmd+V" on macOS, "Strg+V" elsewhere. */
export function shortcutInText(key: string): string {
  return isMac ? `Cmd+${key}` : tr(`Strg+${key}`, `Ctrl+${key}`)
}
