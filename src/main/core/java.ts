import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import type { JavaRuntime } from '@shared/types'
import { paths } from '../paths'
import { log } from '../logger'
import { downloadFile } from './net'
import { extractAll, extractTarGz } from './archive'
import type { Task } from '../tasks'
import { osArch, osName, type VersionJson } from './mojang'

const logger = log('java')
const execFileAsync = promisify(execFile)

const EXE = process.platform === 'win32' ? 'java.exe' : 'java'

/** Detected runtimes, keyed by executable path. */
let cache: JavaRuntime[] | null = null

/* ------------------------------------------------------------------ *
 * Which Java does this version need?
 * ------------------------------------------------------------------ */

/**
 * Mojang states the required Java major in the version JSON. When it is
 * missing (older versions, some loader manifests) we fall back to the
 * well-known thresholds.
 */
export function requiredJavaMajor(version: VersionJson, mcVersion: string): number {
  if (version.javaVersion?.majorVersion) return version.javaVersion.majorVersion

  // Snapshot ids ("24w14a") carry no dotted version at all. Treating them as
  // "1.0" used to fall through every threshold and demand Java 8 — but the
  // two-digit year in front says which era they belong to, so an old snapshot
  // no longer gets handed a JVM that cannot run it.
  const snapshot = /^(\d{2})w\d{2}[a-z]?$/i.exec(mcVersion.trim())
  if (snapshot) {
    const year = Number(snapshot[1])
    // 1.20.5 (Java 21) landed in 24w14a; 1.18 (Java 17) in the 21w3x range;
    // 1.17 (Java 16) in 21w03a. Anything older than that predates the bump.
    if (year >= 24) return 21
    if (year >= 22) return 17
    if (year === 21) return 16
    return 8
  }
  if (!/^\d+\.\d+/.test(mcVersion.trim())) return 21

  const parts = mcVersion.split('.')
  const minor = Number(parts[1] ?? 0)
  const patch = Number((parts[2] ?? '0').split('-')[0])

  if (Number.isNaN(minor)) return 21
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21
  if (minor >= 18) return 17
  if (minor === 17) return 16
  return 8
}

/* ------------------------------------------------------------------ *
 * Detection
 * ------------------------------------------------------------------ */

function parseJavaProperties(output: string): { version: string; vendor: string; arch: string } | null {
  const version = /java\.version\s*=\s*(.+)/.exec(output)?.[1]?.trim()
  const vendor = /java\.vendor\s*=\s*(.+)/.exec(output)?.[1]?.trim()
  const arch = /os\.arch\s*=\s*(.+)/.exec(output)?.[1]?.trim()
  if (!version) return null
  return { version, vendor: vendor ?? 'Unbekannt', arch: arch ?? 'unknown' }
}

/**
 * `os.arch` as a JVM reports it, matched against the architecture the launcher
 * itself runs on. JVMs spell the same architecture several ways.
 */
export function archMatchesHost(arch: string): boolean {
  const normalise = (value: string): string => {
    const lower = value.trim().toLowerCase()
    if (['x86_64', 'amd64', 'x64', 'x86-64'].includes(lower)) return 'x64'
    if (['aarch64', 'arm64'].includes(lower)) return 'arm64'
    if (['x86', 'i386', 'i486', 'i586', 'i686', 'ia32'].includes(lower)) return 'x86'
    return lower
  }
  // An unreadable arch must not disqualify an otherwise fine runtime.
  if (!arch || arch === 'unknown') return true
  return normalise(arch) === normalise(process.arch)
}

export function majorFromVersion(version: string): number {
  // "1.8.0_402" -> 8, "21.0.5" -> 21
  const cleaned = version.trim()
  if (cleaned.startsWith('1.')) return Number(cleaned.split('.')[1]) || 8
  return Number(cleaned.split(/[.\-+]/)[0]) || 0
}

/** Runs `java -XshowSettings:properties -version` and parses the result. */
export async function probeJava(executable: string): Promise<JavaRuntime | null> {
  if (!existsSync(executable)) return null
  try {
    const { stdout, stderr } = await execFileAsync(
      executable,
      ['-XshowSettings:properties', '-version'],
      { timeout: 12_000, windowsHide: true }
    )
    // The properties block goes to stderr on most JVMs.
    const parsed = parseJavaProperties(`${stderr}\n${stdout}`)
    if (!parsed) return null

    return {
      path: executable,
      version: parsed.version,
      major: majorFromVersion(parsed.version),
      vendor: parsed.vendor,
      arch: parsed.arch,
      managed: executable.startsWith(paths.java())
    }
  } catch (err) {
    logger.debug(`Java-Test fehlgeschlagen für ${executable}:`, err)
    return null
  }
}

function candidateRoots(): string[] {
  const roots: string[] = []

  if (process.env.JAVA_HOME) roots.push(process.env.JAVA_HOME)

  if (process.platform === 'win32') {
    const programFiles = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs') : undefined
    ].filter(Boolean) as string[]

    const vendors = [
      'Java',
      'Eclipse Adoptium',
      'Eclipse Foundation',
      'AdoptOpenJDK',
      'Microsoft',
      'Amazon Corretto',
      'BellSoft',
      'Zulu',
      'Semeru',
      'GraalVM',
      'Common Files/Oracle/Java'
    ]

    for (const base of programFiles) {
      for (const vendor of vendors) {
        const dir = join(base, ...vendor.split('/'))
        if (!existsSync(dir)) continue
        try {
          for (const entry of readdirSync(dir)) roots.push(join(dir, entry))
        } catch {
          // unreadable directory
        }
      }
    }

    // Launchers frequently ship their own runtimes; reuse them instead of
    // downloading another copy.
    const appData = process.env.APPDATA
    if (appData) {
      for (const rel of [
        '.minecraft/runtime',
        'PrismLauncher/java',
        'ModrinthApp/java',
        'gdlauncher_next/java'
      ]) {
        const dir = join(appData, ...rel.split('/'))
        if (!existsSync(dir)) continue
        try {
          for (const entry of readdirSync(dir)) {
            const sub = join(dir, entry)
            roots.push(sub)
            try {
              for (const inner of readdirSync(sub)) roots.push(join(sub, inner))
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }
      }
    }
  } else if (process.platform === 'darwin') {
    const base = '/Library/Java/JavaVirtualMachines'
    if (existsSync(base)) {
      for (const entry of readdirSync(base)) roots.push(join(base, entry, 'Contents', 'Home'))
    }
  } else {
    for (const base of ['/usr/lib/jvm', '/usr/java', '/opt/java']) {
      if (!existsSync(base)) continue
      for (const entry of readdirSync(base)) roots.push(join(base, entry))
    }
  }

  // Runtimes Launch Gabi manages itself.
  if (existsSync(paths.java())) {
    for (const entry of readdirSync(paths.java())) roots.push(join(paths.java(), entry))
  }

  return roots
}

/**
 * Where a JDK's launcher sits relative to a runtime root.
 *
 * A plain `bin/` covers Windows and Linux. macOS ships the JDK inside an
 * application bundle, so everything lives under `Contents/Home` instead.
 */
const EXE_SUBPATHS: string[][] = [
  ['bin', EXE],
  ['Contents', 'Home', 'bin', EXE]
]

/**
 * Finds the `java` executable belonging to a runtime root.
 *
 * Exported for the folder-layout test: this function is the only thing
 * standing between a correctly downloaded JDK and "konnte nicht entpackt
 * werden", and it silently got that wrong for every macOS install.
 */
export function executableIn(root: string): string | null {
  for (const parts of EXE_SUBPATHS) {
    const direct = join(root, ...parts)
    if (existsSync(direct)) return direct
  }

  // Adoptium archives unpack into a single versioned folder (`jdk-21.0.1+12`),
  // so the real root is one level down. On macOS that folder then holds the
  // bundle as well — `<versioned>/Contents/Home/bin/java`, four segments deep.
  // Only probing `<versioned>/bin` there is what made every managed install on
  // macOS fail with a misleading "could not be extracted".
  try {
    if (!statSync(root).isDirectory()) return null
    for (const entry of readdirSync(root)) {
      for (const parts of EXE_SUBPATHS) {
        const candidate = join(root, entry, ...parts)
        if (existsSync(candidate)) return candidate
      }
    }
  } catch {
    // ignore
  }
  return null
}

export async function detectJavaRuntimes(force = false): Promise<JavaRuntime[]> {
  if (cache && !force) return cache

  const executables = new Set<string>()

  for (const root of candidateRoots()) {
    const exe = executableIn(root)
    if (exe) executables.add(exe)
  }

  // Whatever is on PATH.
  try {
    const probe = await execFileAsync(process.platform === 'win32' ? 'where' : 'which', ['java'], {
      timeout: 8000,
      windowsHide: true
    })
    for (const line of probe.stdout.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed && existsSync(trimmed)) executables.add(trimmed)
    }
  } catch {
    // java not on PATH
  }

  const results = await Promise.all([...executables].map((exe) => probeJava(exe)))
  const runtimes = results.filter((r): r is JavaRuntime => r !== null && r.major > 0)

  // Deduplicate by version+arch, preferring managed runtimes.
  const byKey = new Map<string, JavaRuntime>()
  for (const runtime of runtimes) {
    const key = `${runtime.version}|${runtime.arch}`
    const existing = byKey.get(key)
    if (!existing || (runtime.managed && !existing.managed)) byKey.set(key, runtime)
  }

  cache = [...byKey.values()].sort((a, b) => b.major - a.major)
  logger.info(`${cache.length} Java-Installationen gefunden`)
  return cache
}

export function invalidateJavaCache(): void {
  cache = null
}

/* ------------------------------------------------------------------ *
 * Automatic installation (Adoptium Temurin)
 * ------------------------------------------------------------------ */

function adoptiumOs(): string {
  switch (osName()) {
    case 'windows':
      return 'windows'
    case 'osx':
      return 'mac'
    default:
      return 'linux'
  }
}

function adoptiumArch(): string {
  switch (osArch()) {
    case 'x64':
      return 'x64'
    case 'arm64':
      return 'aarch64'
    case 'x86':
      return 'x86'
    default:
      return 'x64'
  }
}

/**
 * Downloads a Temurin JRE for the requested major version into the managed
 * java folder. Java 8 needs a full JDK because some old Forge builds call
 * tools from it.
 */
/** Major version -> in-flight install, so two launches share one download. */
const installing = new Map<number, Promise<JavaRuntime>>()

export function installJava(major: number, task?: Task): Promise<JavaRuntime> {
  const running = installing.get(major)
  if (running) return running

  const promise = installJavaOnce(major, task).finally(() => {
    installing.delete(major)
  })
  installing.set(major, promise)
  return promise
}

/**
 * Staging folders this process is filling right now.
 *
 * The sweep below matches on the name alone, and `installing` only dedupes
 * installs of the *same* major. Two different majors can therefore overlap —
 * launching an instance on Java 8 and another on Java 21 does exactly that —
 * and the second install's sweep would delete the first one's half-extracted
 * folder, failing it with a bogus "konnte nicht entpackt werden".
 */
const liveStaging = new Set<string>()

/** Removes staging folders a crashed or killed install left behind. */
function sweepStagingDirs(): void {
  const root = paths.java()
  if (!existsSync(root)) return
  try {
    for (const entry of readdirSync(root)) {
      if (!entry.includes('.new-')) continue
      // Owned by an install that is still running; not ours to delete.
      if (liveStaging.has(entry)) continue
      try {
        rmSync(join(root, entry), { recursive: true, force: true })
        logger.info(`Verwaisten Entpack-Ordner entfernt: ${entry}`)
      } catch {
        // A folder still held open is retried on the next install.
      }
    }
  } catch {
    // best effort
  }
}

async function installJavaOnce(major: number, task?: Task): Promise<JavaRuntime> {
  const targetDir = join(paths.java(), `temurin-${major}`)

  const existing = executableIn(targetDir)
  if (existing) {
    const runtime = await probeJava(existing)
    if (runtime && runtime.major === major) return runtime
  }

  const imageType = major <= 8 ? 'jdk' : 'jre'
  const url =
    `https://api.adoptium.net/v3/binary/latest/${major}/ga/${adoptiumOs()}/${adoptiumArch()}` +
    `/${imageType}/hotspot/normal/eclipse`

  const isZip = adoptiumOs() === 'windows'
  const archive = join(paths.cache(), `temurin-${major}.${isZip ? 'zip' : 'tar.gz'}`)

  task?.update(`Lade Java ${major} herunter…`, null)
  logger.info(`Lade Java ${major} von ${url}`)

  // Staging directory, so a failure cannot leave the existing runtime damaged
  // and a JVM currently running out of `targetDir` keeps its files.
  const staging = `${targetDir}.new-${randomUUID().slice(0, 8)}`
  liveStaging.add(basename(staging))

  // A crash between extraction and the rename below leaves one of these behind
  // forever. They sit inside `paths.java()`, which `candidateRoots()` scans on
  // every detection run, so each leftover costs a pointless `java -version`
  // spawn — and a nearly-complete one can even pass that probe and be offered
  // as a usable runtime. Nothing else in the app sweeps them.
  sweepStagingDirs()

  try {
    let received = 0
    await downloadFile({ url, path: archive }, (delta) => {
      received += delta
      task?.update(`Java ${major} · ${(received / 1024 / 1024).toFixed(1)} MB geladen`, null)
    }, 3, task?.signal)

    task?.update(`Java ${major} wird entpackt…`, null)
    rmSync(staging, { recursive: true, force: true })

    if (isZip) extractAll(archive, staging, true)
    else await extractTarGz(archive, staging)

    const staged = executableIn(staging)
    if (!staged) {
      throw new Error(`Java ${major} konnte nicht entpackt werden`)
    }

    // The download carries no checksum, so the archive itself cannot be
    // verified. Running the unpacked JVM once is the stronger check anyway:
    // it catches a truncated archive, a half-written extraction and a binary
    // for the wrong architecture in one go, and it means `targetDir` only ever
    // receives a runtime that provably starts.
    task?.update(`Java ${major} wird geprüft…`, null)
    const probed = await probeJava(staged)
    if (!probed) {
      throw new Error(`Java ${major} wurde geladen, lässt sich aber nicht starten.`)
    }
    if (probed.major !== major) {
      throw new Error(
        `Es wurde Java ${probed.major} statt Java ${major} geladen, die Installation wurde verworfen.`
      )
    }

    rmSync(targetDir, { recursive: true, force: true })
    renameSync(staging, targetDir)
  } catch (err) {
    // The archive carries no checksum, so a truncated one would be treated as
    // "already downloaded" forever and every later attempt would fail the same
    // way. Removing it makes the next run retry cleanly.
    try {
      rmSync(archive, { force: true })
    } catch {
      // best effort
    }
    try {
      rmSync(staging, { recursive: true, force: true })
    } catch {
      // best effort
    }
    throw err
  } finally {
    liveStaging.delete(basename(staging))
  }

  try {
    rmSync(archive, { force: true })
  } catch {
    // keeping the archive is harmless
  }

  const executable = executableIn(targetDir)
  if (!executable) throw new Error(`Java ${major} konnte nicht entpackt werden`)

  if (process.platform !== 'win32') {
    try {
      chmodSync(executable, 0o755)
    } catch {
      // the archive usually carries the right mode already
    }
  }

  const runtime = await probeJava(executable)
  if (!runtime) throw new Error(`Java ${major} wurde installiert, meldet sich aber nicht`)

  invalidateJavaCache()
  logger.info(`Java ${runtime.version} installiert nach ${targetDir}`)
  return runtime
}

/**
 * Resolves the runtime to launch with: an explicit override wins, otherwise
 * the best matching detected runtime, otherwise a managed download.
 */
export async function resolveJava(options: {
  explicitPath?: string
  major: number
  autoManage: boolean
  task?: Task
}): Promise<JavaRuntime> {
  const { explicitPath, major, autoManage, task } = options

  if (explicitPath) {
    const runtime = await probeJava(explicitPath)
    if (runtime) return runtime
    logger.warn(`Angegebener Java-Pfad unbrauchbar: ${explicitPath}`)
  }

  const detected = await detectJavaRuntimes()

  // A 32-bit JVM caps the heap around 1.5 GB, so picking one for an instance
  // configured with 4-8 GB fails at startup with "Could not reserve enough
  // space for object heap". Prefer runtimes matching the launcher's own arch.
  const native = detected.filter((r) => archMatchesHost(r.arch))
  // Copied, not aliased. `detectJavaRuntimes` hands back its own cached array,
  // and the `.sort()` calls further down mutate in place — without this copy a
  // host whose JVMs are all foreign-arch would leave that shared cache sorted
  // ascending for every later caller, including the settings list.
  const preferred = native.length > 0 ? native : [...detected]

  // Exact major match first; Minecraft is picky about newer JVMs on old versions.
  const exact = preferred.filter((r) => r.major === major)
  if (exact.length > 0) {
    return exact.find((r) => r.managed) ?? exact[0]
  }

  if (!autoManage) {
    // Fall back to the closest newer runtime rather than refusing to start —
    // but only within a range that actually still runs the game. Java 9 removed
    // the reflective access pre-1.13 Forge depends on, so handing a Java 8
    // instance a Java 21 (the only JVM many machines have in 2026) produced a
    // guaranteed crash dressed up as a successful launch. Refusing with an
    // actionable message beats that.
    const LIMIT = 4
    const newer = preferred
      .filter((r) => r.major > major && r.major <= major + LIMIT)
      .sort((a, b) => a.major - b.major)[0]

    if (newer) {
      logger.warn(`Kein Java ${major} gefunden, nutze Java ${newer.major}`)
      return newer
    }

    const closest = preferred.sort((a, b) => a.major - b.major)[0]
    throw new Error(
      `Für diese Version wird Java ${major} benötigt.` +
        (closest
          ? ` Gefunden wurde nur Java ${preferred.map((r) => r.major).join(', ')}, das damit nicht läuft.`
          : ' Es wurde keine Java-Installation gefunden.') +
        ` Aktiviere die automatische Java-Verwaltung in den Einstellungen oder installiere Java ${major}.`
    )
  }

  return installJava(major, task)
}

export function listManagedJava(): string[] {
  if (!existsSync(paths.java())) return []
  return readdirSync(paths.java()).map((entry) => join(paths.java(), entry))
}
