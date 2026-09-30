import type { LogLine } from '@shared/types'

/**
 * Turns Minecraft's console output back into readable lines.
 *
 * Mojang's logging config (assets/log_configs/client-*.xml), which the
 * launcher passes because it also closes Log4Shell on older versions, writes
 * the console as XML for the official launcher to parse:
 *
 *   <log4j:Event logger="..." timestamp="1790783601501" level="WARN" thread="Worker-Main-4">
 *     <log4j:Message><![CDATA[Invalid frame index ...]]></log4j:Message>
 *     <log4j:Throwable><![CDATA[java.lang....]]></log4j:Throwable>
 *   </log4j:Event>
 *
 * Shown raw, every message took three or four lines of markup. This collects
 * one event at a time and hands out a single line in the same form as
 * logs/latest.log, plus the stack trace lines if there is one. Anything that
 * is not part of an event (plain Java output, a crash before logging starts)
 * passes through unchanged.
 */

export interface ParsedLine {
  level: LogLine['level']
  text: string
  time: number
}

/** Guards against a stream that opens an event and never closes it. */
const MAX_EVENT_LINES = 2000

function levelOf(raw: string | undefined): LogLine['level'] {
  switch ((raw ?? '').toUpperCase()) {
    case 'ERROR':
    case 'FATAL':
      return 'error'
    case 'WARN':
      return 'warn'
    case 'DEBUG':
    case 'TRACE':
      return 'debug'
    default:
      return 'info'
  }
}

const ATTRIBUTE_PATTERNS = new Map<string, RegExp>()

function attribute(tag: string, name: string): string | undefined {
  // Built once per name: a flood of events calls this thousands of times a second.
  let pattern = ATTRIBUTE_PATTERNS.get(name)
  if (!pattern) {
    pattern = new RegExp(`\\b${name}="([^"]*)"`)
    ATTRIBUTE_PATTERNS.set(name, pattern)
  }
  const match = pattern.exec(tag)
  if (!match) return undefined
  return match[1]
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Joins every CDATA section inside one element; log4j splits a "]]>" in the text across two. */
function elementText(xml: string, element: string): string | null {
  const open = xml.indexOf(`<log4j:${element}>`)
  if (open === -1) return null
  const close = xml.indexOf(`</log4j:${element}>`, open)
  const inner = xml.slice(open + element.length + 8, close === -1 ? undefined : close)
  const parts: string[] = []
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/g
  let match: RegExpExecArray | null
  while ((match = cdata.exec(inner))) parts.push(match[1])
  return parts.length > 0 ? parts.join('') : inner.trim()
}

export interface Log4jParser {
  /** One raw console line, without its line break. */
  push(raw: string): void
  /** Hands out whatever is still held back, as raw lines. */
  end(): void
}

export function createLog4jParser(
  emit: (line: ParsedLine) => void,
  classifyRaw: (line: string) => LogLine['level']
): Log4jParser {
  let held: string[] | null = null

  const passRaw = (raw: string): void => {
    const line = raw.trimEnd()
    if (line) emit({ level: classifyRaw(line), text: line, time: Date.now() })
  }

  const finishEvent = (lines: string[]): void => {
    const xml = lines.join('\n')
    const openTag = /<log4j:Event\b[^>]*>/.exec(xml)?.[0] ?? ''
    const level = levelOf(attribute(openTag, 'level'))
    const thread = attribute(openTag, 'thread')
    const stamp = Number(attribute(openTag, 'timestamp'))
    const time = Number.isFinite(stamp) && stamp > 0 ? stamp : Date.now()
    const message = elementText(xml, 'Message') ?? ''
    const levelName = (attribute(openTag, 'level') ?? 'INFO').toUpperCase()
    const prefix = thread ? `[${thread}/${levelName}]` : `[${levelName}]`

    const messageLines = message.split(/\r?\n/)
    emit({ level, text: `${prefix} ${messageLines[0] ?? ''}`.trimEnd(), time })
    for (const extra of messageLines.slice(1)) {
      if (extra.trim()) emit({ level, text: extra.trimEnd(), time })
    }

    const throwable = elementText(xml, 'Throwable')
    if (throwable) {
      for (const traceLine of throwable.split(/\r?\n/)) {
        if (traceLine.trim()) emit({ level: level === 'info' ? 'error' : level, text: traceLine.trimEnd(), time })
      }
    }
  }

  return {
    push(raw: string): void {
      if (held) {
        held.push(raw)
        if (raw.includes('</log4j:Event>')) {
          const lines = held
          held = null
          finishEvent(lines)
        } else if (held.length > MAX_EVENT_LINES) {
          const lines = held
          held = null
          lines.forEach(passRaw)
        }
        return
      }
      if (raw.trimStart().startsWith('<log4j:Event')) {
        if (raw.includes('</log4j:Event>')) {
          finishEvent([raw])
        } else {
          held = [raw]
        }
        return
      }
      passRaw(raw)
    },
    end(): void {
      if (held) {
        const lines = held
        held = null
        lines.forEach(passRaw)
      }
    }
  }
}
