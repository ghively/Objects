/**
 * Shape fill and border colours. Values from Capacities' `colorThemes.ts` `colorValues`:
 * `bgDark`/`borderDark` in dark mode, `bgLight`/`borderLight` in light mode. The app is dark
 * until M7 adds light mode; `isDarkMode()` reads the `dark` class on `<html>`.
 */
import type { CSSProperties } from 'react'
import type { WhiteboardFillColor, WhiteboardThemeColor } from '@/api/whiteboardTypes'

interface ColorValue {
  bgLight: string
  borderLight: string
  bgDark: string
  borderDark: string
}

export const COLOR_VALUES: Record<WhiteboardThemeColor, ColorValue> = {
  gray: { bgLight: '#FAF8F5', borderLight: '#E7E2D7', bgDark: '#282E36', borderDark: '#313844' },
  rose: { bgLight: '#FFEAEC', borderLight: '#FDA4AF', bgDark: '#4B2D38', borderDark: '#FB7185' },
  pink: { bgLight: '#FDEDF7', borderLight: '#F9A9D4', bgDark: '#4A2E43', borderDark: '#F471B5' },
  fuchsia: { bgLight: '#FBEEFF', borderLight: '#F0ABFD', bgDark: '#462D54', borderDark: '#E979FA' },
  purple: { bgLight: '#F7EEFF', borderLight: '#D8B4FE', bgDark: '#3B3057', borderDark: '#C084FC' },
  violet: { bgLight: '#F1EFFE', borderLight: '#C3B6FE', bgDark: '#353157', borderDark: '#A88BFB' },
  indigo: { bgLight: '#E8EDFF', borderLight: '#A5B4FD', bgDark: '#2D3255', borderDark: '#818CF9' },
  blue: { bgLight: '#E4EFFE', borderLight: '#92C5FE', bgDark: '#263956', borderDark: '#60A5FB' },
  sky: { bgLight: '#E7F5FE', borderLight: '#7DD3FC', bgDark: '#224053', borderDark: '#38BDF9' },
  cyan: { bgLight: '#DBFBFE', borderLight: '#67E8FA', bgDark: '#22434F', borderDark: '#24D3EE' },
  teal: { bgLight: '#D9FCF6', borderLight: '#5EEAD5', bgDark: '#244346', borderDark: '#2DD4BF' },
  emerald: { bgLight: '#DDFBEB', borderLight: '#6EE7B8', bgDark: '#24433F', borderDark: '#34D399' },
  green: { bgLight: '#E4FDED', borderLight: '#87EFAD', bgDark: '#254638', borderDark: '#49DE80' },
  lime: { bgLight: '#F1FCD9', borderLight: '#BFF164', bgDark: '#34472F', borderDark: '#A3E634' },
  yellow: { bgLight: '#FFFBD2', borderLight: '#FDE047', bgDark: '#48422E', borderDark: '#FACC14' },
  amber: { bgLight: '#FFF6D6', borderLight: '#FBD34C', bgDark: '#4B3D2E', borderDark: '#FBBF24' },
  orange: { bgLight: '#FFF2E0', borderLight: '#FDBA75', bgDark: '#4B362E', borderDark: '#FB923C' },
  red: { bgLight: '#FFE9EA', borderLight: '#FDA5A5', bgDark: '#4A2D33', borderDark: '#F87171' },
}

/** The ring of a node with no `borderColor` (reference CSS `var(--color-border-base)`). */
export const DEFAULT_RING = 'var(--color-border-base)'

export function isDarkMode(): boolean {
  if (typeof document === 'undefined') return true
  return document.documentElement.classList.contains('dark')
}

function themeOf(color: string | undefined): WhiteboardThemeColor | null {
  if (!color) return null
  const c = color.replace(/^bg-/, '')
  return Object.prototype.hasOwnProperty.call(COLOR_VALUES, c) ? (c as WhiteboardThemeColor) : null
}

/** The hex behind a `fillColor` (`bg-<theme>`), or null when unset or unknown. */
export function fillValue(bg: WhiteboardFillColor | string | undefined, dark = isDarkMode()): string | null {
  const c = themeOf(bg)
  return c ? COLOR_VALUES[c][dark ? 'bgDark' : 'bgLight'] : null
}

/** The hex behind a `borderColor` (a theme colour), or null when unset or unknown. */
export function borderValue(theme: WhiteboardThemeColor | string | undefined, dark = isDarkMode()): string | null {
  const c = themeOf(theme)
  return c ? COLOR_VALUES[c][dark ? 'borderDark' : 'borderLight'] : null
}

/** A node's fill: `backgroundColor` and the SVG `fill` for shapes. Empty when unset. */
export function fillStyle(bg: WhiteboardFillColor | string | undefined, dark = isDarkMode()): CSSProperties {
  const v = fillValue(bg, dark)
  return v ? { backgroundColor: v, fill: v } : {}
}

/**
 * A node's border colour as the reference's `--whiteboard-node-color-ring` custom property (the
 * ring rules in `whiteboard.css` fall back to `DEFAULT_RING`), plus `borderColor`/`stroke`.
 */
export function borderStyle(theme: WhiteboardThemeColor | string | undefined, dark = isDarkMode()): CSSProperties {
  const v = borderValue(theme, dark)
  if (!v) return {}
  return { ['--whiteboard-node-color-ring' as string]: v, borderColor: v, stroke: v } as CSSProperties
}

/** A connector's colour as the reference's `--whiteboard-edge-color` custom property. */
export function edgeColorStyle(theme: WhiteboardThemeColor | string | undefined, dark = isDarkMode()): CSSProperties {
  const v = borderValue(theme, dark)
  return v ? ({ ['--whiteboard-edge-color' as string]: v } as CSSProperties) : {}
}
