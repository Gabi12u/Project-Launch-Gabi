import { randomUUID } from 'node:crypto'
import { EVENTS } from '@shared/ipc'
import type { TaskProgress } from '@shared/types'
import { emit } from './events'
import { log } from './logger'

const logger = log('tasks')

const tasks = new Map<string, TaskProgress>()
const cancelled = new Set<string>()
/** Live handles, so `cancelTask` can abort in-flight I/O and not just set a flag. */
const handles = new Map<string, Task>()

/** Drops every trace of a task once the UI has had time to show its result. */
function forget(id: string): void {
  tasks.delete(id)
  handles.delete(id)
  cancelled.delete(id)
}

export class TaskCancelledError extends Error {
  constructor() {
    super('Vorgang abgebrochen')
    this.name = 'TaskCancelledError'
  }
}

/**
 * A unit of long running work that the UI can observe and cancel.
 * Sub-tasks report into the same handle through `child()` so a multi-stage
 * install still shows as a single progress bar.
 */
export class Task {
  readonly id: string
  private task: TaskProgress
  /** Fraction of the total this task's own progress covers. */
  private weightStart = 0
  private weightEnd = 1
  private readonly controller = new AbortController()

  constructor(title: string, detail = '', instanceId?: string) {
    this.id = randomUUID()
    this.task = {
      id: this.id,
      title,
      detail,
      progress: null,
      state: 'running',
      instanceId,
      startedAt: Date.now(),
      updatedAt: Date.now()
    }
    tasks.set(this.id, this.task)
    handles.set(this.id, this)
    this.push()
  }

  private push(): void {
    this.task.updatedAt = Date.now()
    emit(EVENTS.taskUpdate, { ...this.task })
  }

  get cancelled(): boolean {
    return cancelled.has(this.id)
  }

  /**
   * Aborts when the task is cancelled. Pass this to `fetch` and friends so a
   * cancel interrupts the transfer in progress instead of only taking effect
   * between files.
   */
  get signal(): AbortSignal {
    return this.controller.signal
  }

  /** Called by `cancelTask`; tears down in-flight I/O. */
  abort(): void {
    if (!this.controller.signal.aborted) this.controller.abort()
  }

  throwIfCancelled(): void {
    if (this.cancelled) throw new TaskCancelledError()
  }

  /** Restricts this handle to a slice of the overall progress bar. */
  span(from: number, to: number): this {
    this.weightStart = from
    this.weightEnd = to
    return this
  }

  /**
   * Runs `fn` with its progress mapped into `[from, to]` *of the window this
   * task currently occupies*, then restores the previous window. Unlike `span`
   * this nests, so an inner stage cannot blow away its caller's slice and drive
   * the bar to 100% early.
   */
  async within<T>(from: number, to: number, fn: () => Promise<T>): Promise<T> {
    const start = this.weightStart
    const end = this.weightEnd
    const width = end - start
    this.weightStart = start + from * width
    this.weightEnd = start + to * width
    try {
      return await fn()
    } finally {
      this.weightStart = start
      this.weightEnd = end
    }
  }

  update(detail: string, progress?: number | null): void {
    // A finished task must stop emitting; workers that outlive a failure would
    // otherwise keep animating a task the UI already reported as failed.
    if (this.task.state !== 'running') return
    this.task.detail = detail
    if (progress !== undefined) {
      this.task.progress =
        progress === null
          ? null
          : this.weightStart + Math.max(0, Math.min(1, progress)) * (this.weightEnd - this.weightStart)
    }
    this.push()
  }

  setTitle(title: string): void {
    if (this.task.state !== 'running') return
    this.task.title = title
    this.push()
  }

  done(detail = 'Fertig'): void {
    if (this.task.state !== 'running') return
    this.task.state = 'done'
    this.task.detail = detail
    this.task.progress = 1
    this.push()
    setTimeout(() => forget(this.id), 8000)
  }

  fail(error: unknown): void {
    if (this.task.state !== 'running') return
    const message = error instanceof Error ? error.message : String(error)
    this.task.state = error instanceof TaskCancelledError ? 'cancelled' : 'failed'
    this.task.error = message
    this.task.detail = message
    logger.error(`Task "${this.task.title}" fehlgeschlagen:`, error)
    this.push()
    // Nothing else may run under this handle once it has failed.
    this.abort()
    setTimeout(() => forget(this.id), 20000)
  }
}

export function cancelTask(id: string): void {
  cancelled.add(id)
  // Interrupt the transfer in flight, not just the loop between files.
  handles.get(id)?.abort()
  const task = tasks.get(id)
  // A finished task lingers here for a few seconds so the UI can show the
  // result, so a cancel click that lands just after it completed would
  // otherwise relabel it "Wird abgebrochen…" while it still reads as done.
  if (task && task.state === 'running') {
    task.detail = 'Wird abgebrochen…'
    task.updatedAt = Date.now()
    emit(EVENTS.taskUpdate, { ...task })
  }
}

export function listTasks(): TaskProgress[] {
  return [...tasks.values()]
}

/** Runs `fn` inside a task, reporting success or failure automatically. */
export async function withTask<T>(
  title: string,
  detail: string,
  instanceId: string | undefined,
  fn: (task: Task) => Promise<T>
): Promise<T> {
  const task = new Task(title, detail, instanceId)
  try {
    const result = await fn(task)
    task.done()
    return result
  } catch (err) {
    task.fail(err)
    throw err
  }
}
