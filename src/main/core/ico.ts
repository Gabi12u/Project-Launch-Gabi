/**
 * Minimal ICO writer.
 *
 * Windows Vista and newer accept PNG data directly inside an icon entry, so
 * the images the renderer produces can be embedded as-is. That keeps the whole
 * icon pipeline free of native image dependencies.
 */

export interface IcoSource {
  /** Raw PNG bytes. */
  png: Buffer
  /** Edge length in pixels; 256 is encoded as 0 per the format. */
  size: number
}

const HEADER_SIZE = 6
const ENTRY_SIZE = 16

export function buildIco(sources: IcoSource[]): Buffer {
  const images = sources
    .filter((s) => s.png.length > 0 && s.size > 0 && s.size <= 256)
    .sort((a, b) => b.size - a.size)

  if (images.length === 0) throw new Error('Keine Bilddaten für das Icon')

  const header = Buffer.alloc(HEADER_SIZE)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(images.length, 4)

  const directory = Buffer.alloc(ENTRY_SIZE * images.length)
  let offset = HEADER_SIZE + directory.length

  images.forEach((image, index) => {
    const at = index * ENTRY_SIZE
    // 256 does not fit in a byte and is written as 0.
    directory.writeUInt8(image.size >= 256 ? 0 : image.size, at)
    directory.writeUInt8(image.size >= 256 ? 0 : image.size, at + 1)
    directory.writeUInt8(0, at + 2) // palette size, 0 = truecolour
    directory.writeUInt8(0, at + 3) // reserved
    directory.writeUInt16LE(1, at + 4) // colour planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32LE(image.png.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += image.png.length
  })

  return Buffer.concat([header, directory, ...images.map((i) => i.png)])
}

/** Decodes a `data:image/png;base64,…` URL into raw bytes. */
export function decodeDataUrl(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',')
  if (comma === -1) throw new Error('Ungültige Bilddaten')
  return Buffer.from(dataUrl.slice(comma + 1), 'base64')
}

/** Reads the pixel width from a PNG header (bytes 16-19). */
export function pngSize(png: Buffer): number {
  if (png.length < 24) return 0
  return png.readUInt32BE(16)
}

/** Builds an ICO from a set of PNG data URLs produced by the renderer. */
export function icoFromDataUrls(dataUrls: string[]): Buffer {
  const sources: IcoSource[] = []
  for (const url of dataUrls) {
    try {
      const png = decodeDataUrl(url)
      sources.push({ png, size: pngSize(png) })
    } catch {
      // skip unusable entries
    }
  }
  return buildIco(sources)
}
