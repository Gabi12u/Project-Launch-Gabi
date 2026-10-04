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
          const renamed = packs.map((p) => (p === `file/${oldName}` ? `file/${newName}` : p))
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
      editLines(file, (line) => (line === `shaderPack=${oldName}` ? `shaderPack=${newName}` : line))
    }
  }
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
