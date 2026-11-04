import type { CSSProperties } from 'react'

/** The 18 theme colours, in menu order. */
export const THEME_COLORS = [
  'gray',
  'rose',
  'pink',
  'fuchsia',
  'purple',
  'violet',
  'indigo',
  'blue',
  'sky',
  'cyan',
  'teal',
  'emerald',
  'green',
  'lime',
  'yellow',
  'amber',
  'orange',
  'red',
] as const

export type ThemeColor = (typeof THEME_COLORS)[number]

const KNOWN = new Set<string>(THEME_COLORS)

/** A stored colour (`teal`, or a tag's `bg-teal`) as a theme colour; anything unknown is gray. */
export function themeColor(color: string | null | undefined): ThemeColor {
  if (!color) return 'gray'
  const c = color.trim().replace(/^bg-/, '').toLowerCase()
  return KNOWN.has(c) ? (c as ThemeColor) : 'gray'
}

/** The colour's display name: capitalised, except sky, which is "Light blue". */
export function colorName(color: string | null | undefined): string {
  const c = themeColor(color)
  if (c === 'sky') return 'Light blue'
  return c.charAt(0).toUpperCase() + c.slice(1)
}

/** A random theme colour, for new label options and tags. */
export function randomColor(random: () => number = Math.random): ThemeColor {
  return THEME_COLORS[Math.floor(random() * THEME_COLORS.length) % THEME_COLORS.length]
}

/** A tag chip: tag background, tag text. */
export function tagStyle(color: string | null | undefined): CSSProperties {
  const c = themeColor(color)
  return { backgroundColor: `var(--tag-bg-${c})`, color: `var(--tag-text-${c})` }
}

/** A label pill: block background, coloured border, token text. */
export function labelStyle(color: string | null | undefined): CSSProperties {
  const c = themeColor(color)
  return {
    backgroundColor: `var(--label-bg-${c})`,
    borderColor: `var(--label-border-${c})`,
    color: `var(--label-text-${c})`,
  }
}

/** A line or accent colour (progress rings, icon tints). */
export function lineColor(color: string | null | undefined): string {
  return `var(--line-${themeColor(color)})`
}

/** CSS custom properties for a type's colour chip (`--chip-fg`, `--chip-bg`). */
export function chipStyle(color: string | null | undefined): CSSProperties {
  const c = themeColor(color)
  return {
    '--chip-fg': `var(--type-${c}-fg)`,
    '--chip-bg': `var(--type-${c}-bg)`,
  } as CSSProperties
}
