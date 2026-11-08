// colour-literals: content palette
/**
 * Shape fill and border colours (`COLOR_VALUES`):
 * `bgDark`/`borderDark` in dark mode, `bgLight`/`borderLight` in light mode. `isDarkMode()` reads
 * the `dark` class on `<html>`, which `theme/applyTheme.ts` sets for the Dark and Dark Dimmed themes.
 *
 * From the Tailwind CSS v3 default palette (MIT; `theme/tailwindPalette.ts`), per hue h (stone for
 * gray): bgLight h-50, borderLight h-300, bgDark an sRGB mix of 40% h-900 into zinc-900 (the dark
 * surface), borderDark h-400. `colors.test.ts` checks every value against that rule.
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
  gray: { bgLight: '#fafaf9', borderLight: '#d6d3d1', bgDark: '#1a1819', borderDark: '#a8a29e' },
  rose: { bgLight: '#fff1f2', borderLight: '#fda4af', bgDark: '#451626', borderDark: '#fb7185' },
  pink: { bgLight: '#fdf2f8', borderLight: '#f9a8d4', bgDark: '#43182b', borderDark: '#f472b6' },
  fuchsia: { bgLight: '#fdf4ff', borderLight: '#f0abfc', bgDark: '#3b193f', borderDark: '#e879f9' },
  purple: { bgLight: '#faf5ff', borderLight: '#d8b4fe', bgDark: '#321a46', borderDark: '#c084fc' },
  violet: { bgLight: '#f5f3ff', borderLight: '#c4b5fd', bgDark: '#2d1a4c', borderDark: '#a78bfa' },
  indigo: { bgLight: '#eef2ff', borderLight: '#a5b4fc', bgDark: '#222144', borderDark: '#818cf8' },
  blue: { bgLight: '#eff6ff', borderLight: '#93c5fd', bgDark: '#1a2647', borderDark: '#60a5fa' },
  sky: { bgLight: '#f0f9ff', borderLight: '#7dd3fc', bgDark: '#132c3c', borderDark: '#38bdf8' },
  cyan: { bgLight: '#ecfeff', borderLight: '#67e8f9', bgDark: '#172e38', borderDark: '#22d3ee' },
  teal: { bgLight: '#f0fdfa', borderLight: '#5eead4', bgDark: '#162e2e', borderDark: '#2dd4bf' },
  emerald: { bgLight: '#ecfdf5', borderLight: '#6ee7b7', bgDark: '#112e28', borderDark: '#34d399' },
  green: { bgLight: '#f0fdf4', borderLight: '#86efac', bgDark: '#163022', borderDark: '#4ade80' },
  lime: { bgLight: '#f7fee7', borderLight: '#bef264', bgDark: '#243018', borderDark: '#a3e635' },
  yellow: { bgLight: '#fefce8', borderLight: '#fde047', bgDark: '#3c2817', borderDark: '#facc15' },
  amber: { bgLight: '#fffbeb', borderLight: '#fcd34d', bgDark: '#3e2416', borderDark: '#fbbf24' },
  orange: { bgLight: '#fff7ed', borderLight: '#fdba74', bgDark: '#402017', borderDark: '#fb923c' },
  red: { bgLight: '#fef2f2', borderLight: '#fca5a5', bgDark: '#411a1c', borderDark: '#f87171' },
}

/** The ring of a node with no `borderColor` (`var(--color-border-base)`). */
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
 * A node's border colour as the `--whiteboard-node-color-ring` custom property (the
 * ring rules in `whiteboard.css` fall back to `DEFAULT_RING`), plus `borderColor`/`stroke`.
 */
export function borderStyle(theme: WhiteboardThemeColor | string | undefined, dark = isDarkMode()): CSSProperties {
  const v = borderValue(theme, dark)
  if (!v) return {}
  return { ['--whiteboard-node-color-ring' as string]: v, borderColor: v, stroke: v } as CSSProperties
}

/** A connector's colour as the `--whiteboard-edge-color` custom property. */
export function edgeColorStyle(theme: WhiteboardThemeColor | string | undefined, dark = isDarkMode()): CSSProperties {
  const v = borderValue(theme, dark)
  return v ? ({ ['--whiteboard-edge-color' as string]: v } as CSSProperties) : {}
}
