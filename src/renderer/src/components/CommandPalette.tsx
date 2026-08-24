import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { navigate, setState, useStore } from '../lib/store'
import { importModpack, startInstance, stopInstance } from '../lib/actions'
import { LOADER_LABELS, pluralise } from '../lib/format'
import {
  IconCompass,
  IconCube,
  IconDownload,
  IconGrid,
  IconHome,
  IconPackage,
  IconPlay,
  IconPlus,
  IconSave,
  IconSearch,
  IconSettings,
  IconStop
} from './Icons'

interface Command {
  id: string
  label: string
  hint?: string
  group: string
  icon: ReactNode
  /** Extra words the search should match beyond the label. */
  keywords?: string
  run: () => void
}

/**
 * Ctrl+K palette. Everything the launcher can do from one text field: jump to a
 * view, start or stop an instance, create one, import a modpack.
 *
 * Matching is a simple subsequence test, so "sur" finds "Survival" and "fab"
 * finds a Fabric instance without the user typing the name exactly.
 */
export function CommandPalette(): JSX.Element | null {
  const { paletteOpen, instances, starting } = useStore()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const close = (): void => setState({ paletteOpen: false })

  const commands = useMemo<Command[]>(() => {
    const items: Command[] = []

    for (const instance of instances) {
      const busy = starting.includes(instance.id) || instance.installing

      items.push({
        id: `play-${instance.id}`,
        label: instance.running ? `${instance.name} beenden` : `${instance.name} spielen`,
        hint: `${instance.mcVersion} · ${LOADER_LABELS[instance.loader]}${
          instance.modCount > 0
            ? ` · ${instance.modCount} ${pluralise(instance.modCount, 'Mod', 'Mods')}`
            : ''
        }`,
        group: 'Spielen',
        icon: instance.running ? <IconStop size={16} /> : <IconPlay size={16} />,
        keywords: `${instance.mcVersion} ${instance.loader} start launch`,
        run: () => {
          if (instance.running) void stopInstance(instance.id)
          else if (!busy) void startInstance(instance.id, instance.name)
        }
      })

      items.push({
        id: `open-${instance.id}`,
        label: `${instance.name} öffnen`,
        hint: 'Mods, Welten, Einstellungen',
        group: 'Instanzen',
        icon: <IconCube size={16} />,
        keywords: `${instance.mcVersion} ${instance.loader} verwalten`,
        run: () => navigate(`/instances/${instance.id}`)
      })
    }

    items.push(
      {
        id: 'new-instance',
        label: 'Neue Instanz erstellen',
        hint: 'Strg N',
        group: 'Aktionen',
        icon: <IconPlus size={16} />,
        keywords: 'anlegen erstellen create version loader',
        run: () => setState({ createOpen: true })
      },
      {
        id: 'import-modpack',
        label: 'Modpack importieren',
        hint: '.mrpack oder .zip',
        group: 'Aktionen',
        icon: <IconDownload size={16} />,
        keywords: 'mrpack curseforge zip einlesen',
        run: () => void importModpack()
      },
      { id: 'go-home', label: 'Home', group: 'Navigation', icon: <IconHome size={16} />, run: () => navigate('/home') },
      {
        id: 'go-instances',
        label: 'Instanzen',
        group: 'Navigation',
        icon: <IconGrid size={16} />,
        run: () => navigate('/instances')
      },
      {
        id: 'go-mods',
        label: 'Mods',
        group: 'Navigation',
        icon: <IconPackage size={16} />,
        keywords: 'updates inhalte',
        run: () => navigate('/mods')
      },
      {
        id: 'go-discover',
        label: 'Entdecken',
        group: 'Navigation',
        icon: <IconCompass size={16} />,
        keywords: 'modrinth curseforge suchen shader resourcepack',
        run: () => navigate('/discover')
      },
      {
        id: 'go-backups',
        label: 'Backups',
        group: 'Navigation',
        icon: <IconSave size={16} />,
        keywords: 'sicherung wiederherstellen',
        run: () => navigate('/backups')
      },
      {
        id: 'go-settings',
        label: 'Einstellungen',
        group: 'Navigation',
        icon: <IconSettings size={16} />,
        keywords: 'java ram theme sprache account',
        run: () => navigate('/settings')
      }
    )

    return items
  }, [instances, starting])

  const results = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return commands.slice(0, 9)

    return commands
      .map((command) => ({
        command,
        score: score(`${command.label} ${command.keywords ?? ''}`.toLowerCase(), term)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((entry) => entry.command)
  }, [commands, query])

  // Clamped whenever the list shrinks for reasons other than typing: the reset
  // below only watches `query`, but `results` also depends on live instance
  // data. When an entry the cursor pointed at disappeared, no row was
  // highlighted and Enter silently did nothing until an arrow key resynced it.
  useEffect(() => {
    setCursor((current) => (current >= results.length ? Math.max(0, results.length - 1) : current))
  }, [results.length])

  /* --- Open / close ------------------------------------------------ */
  useEffect(() => {
    if (!paletteOpen) return
    setQuery('')
    setCursor(0)
    // The portal mounts this frame; focus has to wait for the next one.
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [paletteOpen])

  useEffect(() => {
    setCursor(0)
  }, [query])

  // Keeps the highlighted row inside the scroll area while arrowing through.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-cursor="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, results])

  if (!paletteOpen) return null

  const runAt = (index: number): void => {
    const command = results[index]
    if (!command) return
    close()
    command.run()
  }

  const onKeyDown = (event: ReactKeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((c) => (results.length === 0 ? 0 : (c + 1) % results.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((c) => (results.length === 0 ? 0 : (c - 1 + results.length) % results.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      runAt(cursor)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  let lastGroup = ''

  return createPortal(
    <div
      className="overlay palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Befehle">
        <div className="palette-input">
          <IconSearch size={17} />
          <input
            ref={inputRef}
            className="input"
            placeholder="Instanz starten, Seite öffnen, Aktion ausführen…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="kbd">Esc</span>
        </div>

        <div className="palette-list" ref={listRef}>
          {results.length === 0 ? (
            <div className="palette-empty">Nichts gefunden für „{query}“</div>
          ) : (
            results.map((command, index) => {
              const header = command.group !== lastGroup ? command.group : null
              lastGroup = command.group

              return (
                <div key={command.id}>
                  {header && <div className="palette-group">{header}</div>}
                  <button
                    data-cursor={index === cursor}
                    className={`palette-item ${index === cursor ? 'on' : ''}`}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => runAt(index)}
                  >
                    <span className="palette-icon">{command.icon}</span>
                    <span className="grow truncate" style={{ textAlign: 'left' }}>
                      {command.label}
                    </span>
                    {command.hint && <span className="palette-hint truncate">{command.hint}</span>}
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className="palette-foot">
          <span>
            <span className="kbd">↑</span> <span className="kbd">↓</span> navigieren
          </span>
          <span>
            <span className="kbd">↵</span> ausführen
          </span>
          <span>
            <span className="kbd">Esc</span> schließen
          </span>
        </div>
      </div>
    </div>,
    document.body
  )
}

/**
 * Subsequence match with a bonus for consecutive characters and for hits at a
 * word start, so "fab" ranks "Fabric" above "Fantastic Blocks".
 */
function score(haystack: string, needle: string): number {
  let index = 0
  let total = 0
  let streak = 0

  for (const char of needle) {
    const found = haystack.indexOf(char, index)
    if (found === -1) return 0

    if (found === index) streak += 1
    else streak = 0

    total += 1 + streak * 2
    if (found === 0 || haystack[found - 1] === ' ') total += 4

    index = found + 1
  }

  // Shorter matches are better matches.
  return total + Math.max(0, 30 - haystack.length) / 10
}
