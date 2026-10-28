/**
 * Prueft, dass ein Java-Archiv fuer macOS und Linux mit seinen
 * Ausfuehrrechten entpackt wird:
 *
 *   node scripts/test-java-tar-modes.mjs
 *
 * 1. `extractTarGz` uebernimmt das Ausfuehrrecht aus dem Tar-Kopf. Vorher
 *    kam jede Datei mit 0644 heraus, `bin/java` liess sich nicht starten und
 *    jedes vom Launcher geladene Java scheiterte mit "wurde geladen, laesst
 *    sich aber nicht starten". Setuid wird dabei nie uebernommen.
 * 2. Das entpackte Java besteht danach den Probelauf, den die Installation
 *    vor dem Uebernehmen macht.
 * 3. Scheitert der Probelauf, nennt er einen Grund.
 *
 * Die Rechte selbst lassen sich nur unter macOS und Linux pruefen. Unter
 * Windows laeuft nur der Teil ohne Rechte, deshalb steht der Test auch in der
 * Release-Pipeline, die auf allen drei Systemen baut.
 */
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = mkdtempSync(join(tmpdir(), 'lg-java-tar-'))
const posix = process.platform !== 'win32'

const problems = []
const notes = []
function check(ok, message) {
  if (!ok) problems.push(message)
}

/**
 * One tar header plus padded content. POSIX ("ustar" plus NUL) by default;
 * `gnu` writes the GNU magic Adoptium's archives carry, with access and
 * change times in the bytes POSIX uses for the path prefix.
 */
function tarEntry(name, { mode = 0o644, type = '0', content = '', gnu = false } = {}) {
  const data = Buffer.from(content, 'utf8')
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write(mode.toString(8).padStart(7, '0') + '\0', 100, 8, 'utf8')
  header.write('0000000\0', 108, 8, 'utf8')
  header.write('0000000\0', 116, 8, 'utf8')
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf8')
  header.write('00000000000\0', 136, 12, 'utf8')
  header.write('        ', 148, 8, 'utf8')
  header.write(type, 156, 1, 'utf8')
  if (gnu) {
    header.write('ustar ', 257, 6, 'utf8')
    header.write(' \0', 263, 2, 'utf8')
    header.write('15123456701\0', 345, 12, 'utf8')
    header.write('15123456702\0', 357, 12, 'utf8')
  } else {
    header.write('ustar\0', 257, 6, 'utf8')
    header.write('00', 263, 2, 'utf8')
  }
  let sum = 0
  for (const byte of header) sum += byte
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8')
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512)
  return Buffer.concat([header, data, padding])
}

try {
  const require = createRequire(import.meta.url)
  const esbuild = require('esbuild')

  const userData = join(work, 'userData')
  mkdirSync(userData, { recursive: true })

  const shim = join(work, 'electron-shim.js')
  writeFileSync(
    shim,
    `const path = ${JSON.stringify(userData)}
     module.exports = {
       app: { getPath: () => path, getVersion: () => '0.0.0-test', isPackaged: false, getName: () => 'launch-gabi' },
       safeStorage: { isEncryptionAvailable: () => false },
       shell: {}, dialog: {}, BrowserWindow: { getAllWindows: () => [] },
       ipcMain: { handle() {}, on() {} },
       desktopCapturer: {}, globalShortcut: {}, Notification: class {}, net: {}
     }`
  )

  const entry = join(work, 'entry.js')
  writeFileSync(
    entry,
    `module.exports = {
       archive: require(${JSON.stringify(join(root, 'src/main/core/archive.ts'))}),
       java: require(${JSON.stringify(join(root, 'src/main/core/java.ts'))})
     }`
  )

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

  const { archive, java } = require(out)

  // A stand-in for `java -XshowSettings:properties -version`: prints the
  // property the probe reads, to stderr like a real JVM.
  const fakeJava = '#!/bin/sh\necho "    java.version = 25.0.5" >&2\necho "    os.arch = amd64" >&2\n'
  const tarball = join(work, 'temurin-25.tar.gz')
  writeFileSync(
    tarball,
    gzipSync(
      Buffer.concat([
        tarEntry('jdk-25.0.5+8-jre/', { mode: 0o755, type: '5' }),
        tarEntry('jdk-25.0.5+8-jre/bin/', { mode: 0o755, type: '5' }),
        tarEntry('jdk-25.0.5+8-jre/bin/java', { mode: 0o755, content: fakeJava }),
        tarEntry('jdk-25.0.5+8-jre/lib/', { mode: 0o755, type: '5' }),
        tarEntry('jdk-25.0.5+8-jre/lib/jspawnhelper', { mode: 0o4755, content: 'helper' }),
        tarEntry('jdk-25.0.5+8-jre/lib/modules', { mode: 0o644, content: 'modules' }),
        Buffer.alloc(1024)
      ])
    )
  )

  // --- 1. Modes from the tar header -----------------------------------------
  const staging = join(work, 'temurin-25.new-test')
  await archive.extractTarGz(tarball, staging)
  const javaFile = join(staging, 'jdk-25.0.5+8-jre', 'bin', 'java')
  const helper = join(staging, 'jdk-25.0.5+8-jre', 'lib', 'jspawnhelper')
  const modules = join(staging, 'jdk-25.0.5+8-jre', 'lib', 'modules')
  check(readFileSync(javaFile, 'utf8') === fakeJava, 'bin/java hat nach dem Entpacken einen anderen Inhalt')
  check(readFileSync(modules, 'utf8') === 'modules', 'lib/modules hat nach dem Entpacken einen anderen Inhalt')
  if (posix) {
    check(java.executableIn(staging) === javaFile, `executableIn fand ${java.executableIn(staging)} statt bin/java`)
    const mode = (file) => statSync(file).mode & 0o7777
    notes.push(`Rechte: bin/java ${mode(javaFile).toString(8)}, jspawnhelper ${mode(helper).toString(8)}, modules ${mode(modules).toString(8)}`)
    check((mode(javaFile) & 0o100) !== 0, `bin/java ist nach dem Entpacken nicht ausführbar (${mode(javaFile).toString(8)})`)
    check((mode(helper) & 0o100) !== 0, `lib/jspawnhelper ist nach dem Entpacken nicht ausführbar (${mode(helper).toString(8)})`)
    check((mode(helper) & 0o4000) === 0, 'Das setuid-Bit aus dem Archiv wurde übernommen')
    check((mode(modules) & 0o111) === 0, `lib/modules wurde ausführbar (${mode(modules).toString(8)})`)

    // --- 2. The probe the install runs before taking the folder over -------
    const probed = await java.probeJava(javaFile, { timeout: 10_000 })
    check(probed?.major === 25, `Probelauf des entpackten Java: ${JSON.stringify(probed)}`)
  } else {
    notes.push('Ausführrechte lassen sich nur unter macOS und Linux prüfen, hier nur Inhalt und Ordneraufbau')
  }

  // --- 2b. Header formats ------------------------------------------------------
  // GNU headers carry times where POSIX has the path prefix; they must not
  // end up in the path. A pax extended header carries a path too long for
  // the plain header and must not become a file of its own.
  const longPath = 'jdk-25.0.5+8-jre/lib/' + 'ein-sehr-langer-ordnername/'.repeat(5) + 'datei.txt'
  const paxBody = (key, value) => {
    const body = ` ${key}=${value}\n`
    let length = body.length + 2
    if (String(length).length + body.length !== length) length = String(length + 1).length + body.length
    return `${length}${body}`
  }
  const formats = join(work, 'formats.tar.gz')
  writeFileSync(
    formats,
    gzipSync(
      Buffer.concat([
        tarEntry('jdk-25.0.5+8-jre/', { mode: 0o755, type: '5', gnu: true }),
        tarEntry('jdk-25.0.5+8-jre/release', { content: 'JAVA_VERSION="25.0.5"', gnu: true }),
        tarEntry('PaxHeaders/datei.txt', { type: 'x', content: paxBody('path', longPath) }),
        tarEntry('jdk-25.0.5+8-jre/lib/ein-sehr-langer-ordnername/abgeschnitten', { content: 'tief' }),
        tarEntry('pax_global_header', { type: 'g', content: paxBody('comment', 'egal') }),
        Buffer.alloc(1024)
      ])
    )
  )
  const formatDir = join(work, 'formats')
  await archive.extractTarGz(formats, formatDir)
  const listed = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => relative(formatDir, join(e.parentPath ?? e.path, e.name)).split(sep).join('/'))
  const unpacked = listed(formatDir).sort()
  notes.push(`Kopfformate entpackt: ${unpacked.join(', ')}`)
  check(unpacked.includes('jdk-25.0.5+8-jre/release'), 'Eine Datei mit GNU-Kopf landete nicht unter ihrem Pfad')
  check(unpacked.includes(longPath), 'Der lange Pfad aus dem pax-Kopf wurde nicht benutzt')
  check(unpacked.length === 2, `Kopfdaten wurden als eigene Dateien geschrieben: ${unpacked.join(', ')}`)

  // --- 3. A failed probe names its reason -------------------------------------
  const broken = join(work, 'broken', 'bin', posix ? 'java' : 'java.exe')
  mkdirSync(dirname(broken), { recursive: true })
  writeFileSync(broken, 'kein Programm')
  let reason = ''
  const none = await java.probeJava(broken, { timeout: 10_000, onFailure: (why) => (reason = why) })
  check(none === null, 'Eine kaputte Java-Datei bestand den Probelauf')
  check(reason.length > 0, 'Ein gescheiterter Probelauf nannte keinen Grund')
  notes.push(`Grund bei kaputter Datei: ${reason}`)
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
