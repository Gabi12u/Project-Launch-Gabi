/**
 * Prueft, welche Bibliotheken resolveLibraries liefert.
 *
 *   node scripts/test-library-resolution.mjs
 *
 * 1. Der Forge-Installer braucht fuer seine Schritte dieselbe Bibliothek in
 *    mehreren Versionen (Forge 1.20.1: srgutils 0.4.3, 0.4.9 und 0.5.6).
 *    Geladen wurde nur die erste, und Schritt 1 scheiterte auf jedem PC, der
 *    die anderen nicht schon hatte. Fuer das Spiel selbst bleibt es bei einer
 *    Version je Bibliothek.
 * 2. Die Snapshots 22w18a und 22w19a listen eine Bibliothek, die nur Natives
 *    fuer Linux hat und keine eigene Jar. Unter Windows und macOS wurde dafuer
 *    eine erfundene Adresse geladen (404), und beide Snapshots liessen sich
 *    dort nicht installieren.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-libraries-'))

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')
  const userData = join(work, 'userData')
  mkdirSync(userData, { recursive: true })
  const shim = join(work, 'electron-shim.js')
  writeFileSync(
    shim,
    `module.exports = {
       app: { getPath: () => ${JSON.stringify(userData)}, getVersion: () => '0.0.0-test', isPackaged: false, getName: () => 'launch-gabi' },
       safeStorage: { isEncryptionAvailable: () => false },
       shell: {}, dialog: {}, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle() {}, on() {} },
       desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}
     }`
  )
  const entry = join(work, 'entry.js')
  writeFileSync(entry, `module.exports = require(${JSON.stringify(join(root, 'src/main/core/mojang.ts'))})`)
  const out = join(work, 'bundle.cjs')
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: out,
    alias: { '@shared': join(root, 'src/shared'), electron: shim },
    logLevel: 'error'
  })
  const { resolveLibraries } = require(out)

  const lib = (name) => {
    const [group, artifact, version] = name.split(':')
    const path = `${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}.jar`
    return { name, downloads: { artifact: { path, url: `https://maven.example/${path}`, sha1: '0'.repeat(40), size: 1 } } }
  }
  const profile = {
    id: 'test',
    libraries: [
      lib('net.minecraftforge:srgutils:0.4.3'),
      lib('net.minecraftforge:srgutils:0.4.9'),
      lib('net.minecraftforge:srgutils:0.5.6'),
      lib('net.sf.jopt-simple:jopt-simple:5.0.4'),
      lib('net.sf.jopt-simple:jopt-simple:6.0-alpha-3')
    ]
  }

  // --- 1. Every version for the installer, one for the game -------------
  const forInstaller = resolveLibraries(profile, { everyVersion: true }).map((l) => l.library.name)
  check(forInstaller.length === 5, `Für den Installer: ${forInstaller.join(', ')}`)
  const forGame = resolveLibraries(profile).map((l) => l.library.name)
  check(
    forGame.join(',') === 'net.minecraftforge:srgutils:0.4.3,net.sf.jopt-simple:jopt-simple:5.0.4',
    `Für das Spiel: ${forGame.join(', ')}`
  )
  notes.push(`Installer bekommt ${forInstaller.length} Bibliotheken, das Spiel ${forGame.length}.`)

  // --- 2. Natives for another system only, with no jar of its own -------
  const snapshot = {
    id: '22w18a',
    libraries: [
      {
        name: 'io.netty:netty-transport-native-epoll:4.1.77.Final',
        natives: { linux: 'linux-x86_64' },
        downloads: {
          classifiers: {
            'linux-x86_64': {
              path: 'io/netty/netty-transport-native-epoll/4.1.77.Final/netty-transport-native-epoll-4.1.77.Final-linux-x86_64.jar',
              url: 'https://libraries.minecraft.net/io/netty/netty-transport-native-epoll/4.1.77.Final/netty-transport-native-epoll-4.1.77.Final-linux-x86_64.jar',
              sha1: '0'.repeat(40),
              size: 1
            }
          }
        }
      },
      lib('io.netty:netty-transport-classes-epoll:4.1.77.Final')
    ]
  }
  const names = resolveLibraries(snapshot).map((l) => `${l.library.name}${l.native ? ' (native)' : ''}`)
  if (process.platform === 'linux') {
    check(names.some((n) => n.includes('native-epoll') && n.includes('native')), `Unter Linux fehlt die Native: ${names.join(', ')}`)
  } else {
    check(!names.some((n) => n.includes('native-epoll')), `Unter ${process.platform} wird die reine Linux-Native geladen: ${names.join(', ')}`)
    check(names.some((n) => n.includes('classes-epoll')), `Die normale Jar fehlt: ${names.join(', ')}`)
  }
  notes.push(`22w18a unter ${process.platform}: ${names.join(', ')}`)
} catch (err) {
  problems.push(`Testlauf abgebrochen: ${err?.stack ?? err}`)
} finally {
  try {
    rmSync(work, { recursive: true, force: true })
  } catch {
    // best effort cleanup
  }
}

console.log('\n=== Beobachtungen ===')
for (const note of notes) console.log(`  - ${note}`)
console.log('\n=== Probleme ===')
if (problems.length === 0) console.log('  keine')
else for (const problem of problems) console.log(`  X ${problem}`)
console.log(`\nERGEBNIS: ${problems.length === 0 ? 'BESTANDEN' : `FEHLGESCHLAGEN (${problems.length})`}`)
process.exitCode = problems.length === 0 ? 0 : 1
