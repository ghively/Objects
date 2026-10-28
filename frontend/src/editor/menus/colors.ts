/**
 * Block colours (`color=text-<c>` / `color=bg-<c>` in a block annotation): the
 * menu order and the theme token for each.
 *
 * The order is Object's `themeColors` order (M2's `THEME_COLORS`). Block
 * colours use the label tokens (Global Constraints, "Theme tokens"): text is
 * `--label-text-<c>` (Object's `blockText`), background is `--label-bg-<c>`
 * (`blockBg`) with Object's `.theme-option-bg-*` text colour, `--tag-text-<c>`.
 */
import { THEME_COLORS, type ThemeColor } from '@/theme/palette'

export const BLOCK_COLORS: readonly ThemeColor[] = THEME_COLORS

export type ColorKind = 'text' | 'bg'

const KNOWN = new Set<string>(THEME_COLORS)

/** The option value for a colour: `text-blue`, `bg-blue`. */
export function colorValue(kind: ColorKind, color: ThemeColor): string {
  return `${kind}-${color}`
}

/** `text-blue` -> `{kind: 'text', color: 'blue'}`; anything else is null. */
export function parseColorValue(value: string | true | null | undefined): { kind: ColorKind; color: ThemeColor } | null {
  if (typeof value !== 'string') return null
  const m = /^(text|bg)-([a-z]+)$/.exec(value)
  if (!m || !KNOWN.has(m[2])) return null
  return { kind: m[1] as ColorKind, color: m[2] as ThemeColor }
}

/** The token a text colour paints with. */
export function textColorToken(color: ThemeColor): string {
  return `var(--label-text-${color})`
}

/** The token a background colour paints with. */
export function bgColorToken(color: ThemeColor): string {
  return `var(--label-bg-${color})`
}

/** The text colour that goes with a background colour (Object's `.theme-option-bg-*`). */
export function bgTextToken(color: ThemeColor): string {
  return `var(--tag-text-${color})`
}

/** The inline style for a block colour option value; empty for an unknown value. */
export function colorStyle(value: string | true | null | undefined): string {
  const parsed = parseColorValue(value)
  if (!parsed) return ''
  return parsed.kind === 'text'
    ? `color: ${textColorToken(parsed.color)};`
    : `background-color: ${bgColorToken(parsed.color)}; color: ${bgTextToken(parsed.color)};`
}

function capitalised(color: ThemeColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1)
}

/**
 * The menu name: "Blue text" / "Blue background" (`colorThemes.theme-text-<c>`,
 * `colorThemes.theme-bg-<c>`; sky is "Sky" here, not M2's "Light blue").
 */
export function colorMenuName(kind: ColorKind, color: ThemeColor): string {
  return `${capitalised(color)} ${kind === 'text' ? 'text' : 'background'}`
}
