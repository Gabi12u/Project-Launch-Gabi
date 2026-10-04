import { memo, type JSX } from 'react'
import type { LogLine } from '@shared/types'
import { formatTime } from '../lib/format'

/**
 * One line of a live log, shared by the Log tab and the separate log window.
 *
 * Both views keep the newest 1200 lines and used to key them by position. At
 * the cap every batch shifted every position, so each of the ten batches a
 * second rebuilt and re-formatted all 1200 rows; a mod flooding the log left
 * the launcher at two or three frames a second. Keyed by the line itself and
 * memoised, a batch now only adds its new rows and drops the oldest.
 */
export const LogRow = memo(function LogRow({ line }: { line: LogLine }): JSX.Element {
  return (
    <div className={`log-line ${line.stream === 'launcher' ? 'launcher' : line.level}`}>
      <span className="log-time">{formatTime(line.time)}</span>
      <span>{line.text}</span>
    </div>
  )
})

const lineKeys = new WeakMap<LogLine, number>()
let nextLineKey = 0

/** A stable React key for a line object, assigned the first time it is seen. */
export function logLineKey(line: LogLine): number {
  let key = lineKeys.get(line)
  if (key === undefined) {
    key = nextLineKey++
    lineKeys.set(line, key)
  }
  return key
}

/**
 * Collects incoming lines and hands them to `apply` at most every `delayMs`.
 *
 * The first lines after a quiet spell go through at once, so a normal log
 * still reads live. Under a flood the view is rebuilt four times a second
 * instead of ten: at the 1200 line cap each rebuild replaces every row, and
 * doing that ten times a second kept the window near its limit.
 */
export function createLineBatcher(
  apply: (lines: LogLine[]) => void,
  delayMs = 250
): { push: (lines: LogLine[]) => void; flushNow: () => void; dispose: () => void } {
  let queued: LogLine[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastFlush = 0

  const flush = (): void => {
    timer = null
    lastFlush = Date.now()
    if (queued.length === 0) return
    const lines = queued
    queued = []
    apply(lines)
  }

  return {
    push(lines) {
      queued.push(...lines)
      // Nothing older than the views keep is worth holding on to.
      if (queued.length > 1200) queued = queued.slice(-1200)
      if (timer) return
      const wait = delayMs - (Date.now() - lastFlush)
      if (wait <= 0) flush()
      else timer = setTimeout(flush, wait)
    },
    /**
     * Hands over what is queued right now. Called before the history merge:
     * lines still waiting here were not in the state the merge compares
     * against, so they arrived again afterwards and showed twice.
     */
    flushNow() {
      if (timer) clearTimeout(timer)
      flush()
    },
    dispose() {
      if (timer) clearTimeout(timer)
      timer = null
      queued = []
    }
  }
}
