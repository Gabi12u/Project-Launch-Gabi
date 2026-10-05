import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ContentType } from '@shared/types'
import { paths } from '../paths'
import { log } from '../logger'

const logger = log('packSelection')

/**
 * Carries the game's own selection of a resource pack or shader pack over to
 * its new file name after an update.
 *
 * An update replaces the file, and the new name usually carries the new
 * version number. Minecraft keeps the selected packs in options.txt as
 * "file/<name>", and Iris, Oculus and OptiFine keep the chosen shader pack by
 * file name too. None of them find the old name any more, so the pack the
 * player had switched on was silently switched off by every update.
 */
export function renamePackSelection(instanceId: string, type: ContentType, oldName: string, newName: string): void {
  if (oldName === newName) return
  const gameDir = paths.gameDir(instanceId)
  if (type === 'resourcepack') {
    editLines(join(gameDir, 'options.txt'), (line) => {
      for (const key of ['resourcePacks:', 'incompatibleResourcePacks:']) {
        if (!line.startsWith(key)) continue
        try {
          const packs: unknown = JSON.parse(line.slice(key.length))
          if (!Array.isArray(packs)) return line
          // Minecraft before 1.13 lists the bare file name, without "file/".
          const renamed = packs.map((p) =>
            p === `file/${oldName}` ? `file/${newName}` : p === oldName ? newName : p
          )
          return `${key}${JSON.stringify(renamed)}`
        } catch {
          // Left as it is: an unreadable line is not this function's to repair.
          return line
        }
      }
      return line
    })
  } else if (type === 'shaderpack') {
    for (const file of [
      join(gameDir, 'config', 'iris.properties'),
      join(gameDir, 'config', 'oculus.properties'),
      join(gameDir, 'optionsshaders.txt')
    ]) {
      editLines(file, (line) => {
        if (!line.startsWith('shaderPack=')) return line
        const raw = line.slice('shaderPack='.length)
        if (raw === oldName) return `shaderPack=${newName}`
        // Written through Java's Properties, which escapes umlauts as \uXXXX
        // and a few characters such as "#" or ":" with a backslash. A pack
        // named that way never equalled the plain file name above.
        if (unescapeProperty(raw) === oldName) return `shaderPack=${escapeProperty(newName)}`
        return line
      })
    }
  }
}

/** Reverses the escaping `java.util.Properties` applies to a value. */
function unescapeProperty(value: string): string {
  return value.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, seq: string) => {
    if (seq.length === 5) return String.fromCharCode(parseInt(seq.slice(1), 16))
    return { t: '\t', n: '\n', r: '\r', f: '\f' }[seq] ?? seq
  })
}

/** Escapes a value the way `java.util.Properties.store` writes it. */
function escapeProperty(value: string): string {
  let out = ''
  for (const [i, ch] of [...value].entries()) {
    const code = ch.charCodeAt(0)
    if (ch === '\\' || ch === '=' || ch === ':' || ch === '#' || ch === '!') out += `\\${ch}`
    else if (ch === ' ' && i === 0) out += '\\ '
    else if (code < 0x20 || code > 0x7e) {
      for (const unit of ch.split('')) out += `\\u${unit.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`
    } else out += ch
  }
  return out
}

/** Rewrites a text file line by line, keeping its line endings, and only if something changed. */
function editLines(file: string, edit: (line: string) => string): void {
  if (!existsSync(file)) return
  try {
    const raw = readFileSync(file, 'utf8')
    const eol = raw.includes('\r\n') ? '\r\n' : '\n'
    const lines = raw.split(/\r?\n/)
    const next = lines.map(edit)
    if (next.every((line, i) => line === lines[i])) return
    writeFileSync(file, next.join(eol), 'utf8')
  } catch (err) {
    logger.warn(`Auswahl in ${file} nicht angepasst:`, err)
  }
}
