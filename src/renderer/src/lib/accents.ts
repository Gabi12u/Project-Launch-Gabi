import { tr } from '@shared/i18n'

/**
 * Spoken names for the accent swatches, read out by screen readers instead
 * of the raw hex value. Shared by the onboarding and the create wizard, which
 * offer the same swatches.
 */
export function accentName(color: string): string {
  const names: Record<string, string> = {
    '#7c5cff': tr('Lila', 'Purple'),
    '#4f7bff': tr('Blau', 'Blue'),
    '#22c6f2': tr('Türkis', 'Turquoise'),
    '#25d0a1': tr('Smaragd', 'Emerald'),
    '#5ec26a': tr('Grün', 'Green'),
    '#f2c33d': tr('Gelb', 'Yellow'),
    '#ff8a3d': tr('Orange', 'Orange'),
    '#ff5c7a': tr('Rot', 'Red'),
    '#e254d8': tr('Pink', 'Pink'),
    '#9aa4c4': tr('Graublau', 'Slate blue')
  }
  return names[color.toLowerCase()] ?? color
}
