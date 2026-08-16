/**
 * Renders an instance icon into PNGs for the Windows shortcut.
 *
 * This lives in the renderer because only the browser process can rasterise
 * emoji and arbitrary images; the main process turns the results into an .ico.
 */

const SIZES = [256, 128, 64, 48, 32, 16]

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function shade(hex: string, amount: number): string {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const value = parseInt(full, 16)
  const channel = (shift: number): number => {
    const base = (value >> shift) & 255
    return Math.max(0, Math.min(255, Math.round(base + (255 - base) * amount)))
  }
  const to = (v: number): string => v.toString(16).padStart(2, '0')
  return `#${to(channel(16))}${to(channel(8))}${to(channel(0))}`
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Bild konnte nicht geladen werden'))
    image.src = src
  })
}

interface IconInput {
  /** Emoji, or an absolute path when the user picked a picture. */
  icon: string
  accent: string
  /** Absolute path of a custom icon image, if the instance has one. */
  imagePath?: string | null
}

/**
 * Produces one PNG data URL per icon size: the accent as a rounded gradient
 * tile with the emoji on top, or the user's own picture cropped to a square.
 */
export async function renderInstanceIcon(input: IconInput): Promise<string[]> {
  let picture: HTMLImageElement | null = null

  if (input.imagePath) {
    try {
      const url = `file://${input.imagePath.replace(/\\/g, '/')}`
      picture = await loadImage(url)
    } catch {
      picture = null
    }
  }

  const results: string[] = []

  for (const size of SIZES) {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) continue

    const radius = size * 0.22

    if (picture) {
      // Cover-crop the picture into the rounded square.
      ctx.save()
      roundedRect(ctx, 0, 0, size, size, radius)
      ctx.clip()

      const scale = Math.max(size / picture.width, size / picture.height)
      const w = picture.width * scale
      const h = picture.height * scale
      ctx.drawImage(picture, (size - w) / 2, (size - h) / 2, w, h)
      ctx.restore()
    } else {
      const gradient = ctx.createLinearGradient(0, size, size, 0)
      gradient.addColorStop(0, input.accent)
      gradient.addColorStop(1, shade(input.accent, 0.35))

      ctx.save()
      roundedRect(ctx, 0, 0, size, size, radius)
      ctx.clip()
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, size, size)

      // A soft highlight keeps the tile from looking flat.
      const glow = ctx.createRadialGradient(size * 0.3, size * 0.22, 0, size * 0.3, size * 0.22, size * 0.8)
      glow.addColorStop(0, 'rgba(255,255,255,0.30)')
      glow.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, size, size)
      ctx.restore()

      // Emoji are drawn slightly below the centre to look optically centred.
      ctx.font = `${Math.round(size * 0.58)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#ffffff'
      ctx.fillText(input.icon, size / 2, size * 0.54)
    }

    results.push(canvas.toDataURL('image/png'))
  }

  return results
}
