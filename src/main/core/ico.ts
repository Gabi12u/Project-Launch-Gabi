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
  /** Width in pixels; 256 is encoded as 0 per the format. */
  size: number
  /** Height in pixels. Equal to `size` for the square icons we generate. */
  height?: number
}

const HEADER_SIZE = 6
const ENTRY_SIZE = 16
/** Every PNG starts with these eight bytes. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** True when the buffer really is a PNG, not merely long enough to look like one. */
export function isPng(buffer: Buffer): boolean {
  return buffer.length >= 24 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)
}

export function buildIco(sources: IcoSource[]): Buffer {
  const images = sources
    // The signature check matters: without it any buffer of 24+ bytes whose
    // bytes 16-19 happened to read as 1-256 was embedded verbatim, and Windows
    // showed a blank icon instead of the write failing cleanly.
    .filter((s) => isPng(s.png) && s.size > 0 && s.size <= 256)
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
    // 256 does not fit in a byte and is written as 0. Height is its own field:
    // deriving it from the width put a wrong size in the directory for any
    // non-square source, which is what Windows picks an icon by.
    const height = image.height ?? image.size
    directory.writeUInt8(image.size >= 256 ? 0 : image.size, at)
    directory.writeUInt8(height >= 256 ? 0 : height, at + 1)
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
  if (!isPng(png)) return 0
  return png.readUInt32BE(16)
}

/** Reads the pixel height from a PNG header (bytes 20-23). */
export function pngHeight(png: Buffer): number {
  if (!isPng(png)) return 0
  return png.readUInt32BE(20)
}

/** Builds an ICO from a set of PNG data URLs produced by the renderer. */
export function icoFromDataUrls(dataUrls: string[]): Buffer {
  const sources: IcoSource[] = []
  for (const url of dataUrls) {
    try {
      const png = decodeDataUrl(url)
      sources.push({ png, size: pngSize(png), height: pngHeight(png) })
    } catch {
      // skip unusable entries
    }
  }
  return buildIco(sources)
}
