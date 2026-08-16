import { useEffect, useRef, type JSX } from 'react'
import { useStore } from '../lib/store'

interface Voxel {
  x: number
  y: number
  size: number
  angle: number
  alpha: number
}

/**
 * The backdrop: three colour fields, a perspective floor grid and a scatter of
 * voxel cubes.
 *
 * Everything here is painted once and then left alone. An earlier version
 * animated the fields and drifted the voxels on an animation-frame loop; on a
 * laptop that alone accounted for roughly half the launcher's CPU, because a
 * running animation forces the compositor to produce frames forever whether or
 * not anything meaningful changed. The static version is nearly indis-
 * tinguishable at these opacities and costs nothing once drawn.
 */
export function Ambient(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const { settings } = useStore()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || settings.reduceMotion) return

    const context = canvas.getContext('2d')
    if (!context) return

    /** A flat-shaded cube: body, lit top edge, outline. */
    const drawCube = (voxel: Voxel, colour: string): void => {
      const s = voxel.size
      context.save()
      context.translate(voxel.x, voxel.y)
      context.rotate(voxel.angle)

      context.globalAlpha = voxel.alpha
      context.fillStyle = colour
      context.fillRect(-s / 2, -s / 2, s, s)

      context.globalAlpha = voxel.alpha * 0.55
      context.fillStyle = '#ffffff'
      context.fillRect(-s / 2, -s / 2, s, s * 0.28)

      context.globalAlpha = voxel.alpha * 0.9
      context.strokeStyle = colour
      context.lineWidth = 1
      context.strokeRect(-s / 2, -s / 2, s, s)
      context.restore()
    }

    const paint = (): void => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width === 0 || height === 0) return

      canvas.width = Math.floor(width * ratio)
      canvas.height = Math.floor(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)

      const colour =
        getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7c5cff'

      // Density scales with the window so a maximised launcher is not emptier
      // than a small one.
      const count = Math.min(38, Math.round((width * height) / 42000))

      for (let i = 0; i < count; i++) {
        drawCube(
          {
            x: Math.random() * width,
            y: Math.random() * height,
            size: 4 + Math.random() * 10,
            angle: Math.random() * Math.PI,
            alpha: 0.12 + Math.random() * 0.34
          },
          colour
        )
      }
    }

    paint()

    // Re-scatter on resize only; nothing else invalidates the layer.
    let pending = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(pending)
      pending = requestAnimationFrame(paint)
    })
    observer.observe(canvas)

    return () => {
      cancelAnimationFrame(pending)
      observer.disconnect()
    }
    // Repaint when the accent changes so the voxels follow the theme.
  }, [settings.accentColor, settings.theme, settings.reduceMotion])

  return (
    <div className="ambient" aria-hidden="true">
      <div className="aurora a" />
      <div className="aurora b" />
      <div className="aurora c" />
      {!settings.reduceMotion && <canvas ref={canvasRef} className="voxel-field" />}
      <div className="ambient-grid" />
      <div className="ambient-vignette" />
    </div>
  )
}
