/**
 * Public API color tokens for blocks. Keep in sync with `util/colorThemes.ts` (`textOrBackgroundColorThemeSchema`).
 */
import { z } from 'zod'

const backgroundColorThemes = [
  'bg-gray',
  'bg-rose',
  'bg-pink',
  'bg-fuchsia',
  'bg-purple',
  'bg-violet',
  'bg-indigo',
  'bg-blue',
  'bg-sky',
  'bg-cyan',
  'bg-teal',
  'bg-emerald',
  'bg-green',
  'bg-lime',
  'bg-yellow',
  'bg-amber',
  'bg-orange',
  'bg-red',
] as const

const textColorThemes = [
  'text-gray',
  'text-rose',
  'text-pink',
  'text-fuchsia',
  'text-purple',
  'text-violet',
  'text-indigo',
  'text-blue',
  'text-sky',
  'text-cyan',
  'text-teal',
  'text-emerald',
  'text-green',
  'text-lime',
  'text-yellow',
  'text-amber',
  'text-orange',
  'text-red',
] as const

export const textOrBackgroundColorThemeSchema = z.union([z.enum(textColorThemes), z.enum(backgroundColorThemes)])
export type TextOrBackgroundColorTheme = z.infer<typeof textOrBackgroundColorThemeSchema>
