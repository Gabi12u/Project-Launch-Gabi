import type { JSX } from 'react'
import {
  IconDownload,
  IconGrid,
  IconHome,
  IconImage,
  IconInfo,
  IconPackage,
  IconSettings,
  IconSparkle
} from '../components/Icons'

export interface NavEntry {
  id: string
  label: string
  icon: JSX.Element
  route: string
  /** Kept apart from the rest, at the end of the bar or below a separator. */
  trailing?: boolean
}

/**
 * The one list both navigations render.
 *
 * The bar across the top and the column down the side are two views of the
 * same thing, and the entries used to live in the sidebar component alone.
 * Anything added in one place had to be remembered in the other, which is
 * exactly how two navigations drift apart.
 */
export const NAV_ENTRIES: NavEntry[] = [
  { id: 'home', label: 'Startseite', icon: <IconHome />, route: '/home' },
  { id: 'instances', label: 'Instanzen', icon: <IconGrid />, route: '/instances' },
  { id: 'mods', label: 'Mods', icon: <IconPackage />, route: '/mods' },
  { id: 'resourcepacks', label: 'Resource Packs', icon: <IconImage />, route: '/resourcepacks' },
  { id: 'shaders', label: 'Shader', icon: <IconSparkle />, route: '/shaders' },
  { id: 'downloads', label: 'Downloads', icon: <IconDownload />, route: '/downloads' },
  { id: 'news', label: 'News', icon: <IconInfo />, route: '/news' },
  { id: 'settings', label: 'Einstellungen', icon: <IconSettings />, route: '/settings', trailing: true }
]
