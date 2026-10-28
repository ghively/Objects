/**
 * Puts the device settings' theme on `<html>`: `data-theme` (Light, Light Dimmed, Dark, Dark
 * Dimmed; `themes.css` holds their tokens), the `dark` class for the two dark themes (so Tailwind's
 * `dark:` variants, React Flow and `whiteboard/colors.ts` follow), `data-mono-tags`,
 * `data-mono-type-labels` and `data-font`. The result is cached in `localStorage` `object.theme`;
 * `index.html`'s inline script reads that cache and sets the same attributes before the bundle
 * loads, so the first paint already has the right theme (no cache: dark).
 */
import { useSyncExternalStore } from 'react'
import type { DeviceSettings } from '@/api/types'

export type ThemeName = 'light' | 'lightDimmed' | 'dark' | 'darkDimmed'

export const THEME_NAMES: readonly ThemeName[] = ['light', 'lightDimmed', 'dark', 'darkDimmed']

/** The `localStorage` key of the first-paint cache. */
export const THEME_CACHE_KEY = 'object.theme'

/** What `applyTheme` writes to `<html>` (and caches, as JSON). */
export interface ThemeAttrs {
  theme: ThemeName
  dark: boolean
  monoTags: boolean
  monoTypeLabels: boolean
  font: DeviceSettings['font']
}

type ThemeSettings = Pick<DeviceSettings, 'themeMode' | 'lightTheme' | 'darkTheme' | 'font' | 'monochromeTags' | 'monochromeTypeLabels'>

const FONTS: readonly DeviceSettings['font'][] = ['sans-serif', 'serif', 'monospace']

/** The theme the settings pick: `themeMode` chooses between `lightTheme` and `darkTheme`. */
export function themeAttrs(settings: ThemeSettings): ThemeAttrs {
  const light = settings.themeMode === 'light'
  const theme: ThemeName = light
    ? settings.lightTheme === 'lightDimmed'
      ? 'lightDimmed'
      : 'light'
    : settings.darkTheme === 'darkDimmed'
      ? 'darkDimmed'
      : 'dark'
  return {
    theme,
    dark: !light,
    monoTags: !!settings.monochromeTags,
    monoTypeLabels: !!settings.monochromeTypeLabels,
    font: FONTS.includes(settings.font) ? settings.font : 'sans-serif',
  }
}

function setFlag(root: HTMLElement, name: string, on: boolean) {
  if (on) root.setAttribute(name, '')
  else root.removeAttribute(name)
}

/** Write `attrs` onto `root` (the same rules as `index.html`'s first-paint script). */
export function applyThemeAttrs(attrs: ThemeAttrs, root: HTMLElement = document.documentElement): void {
  root.setAttribute('data-theme', attrs.theme)
  root.classList.toggle('dark', attrs.dark)
  setFlag(root, 'data-mono-tags', attrs.monoTags)
  setFlag(root, 'data-mono-type-labels', attrs.monoTypeLabels)
  root.setAttribute('data-font', attrs.font)
}

/** Apply the settings' theme to `root` and cache it for the next first paint. */
export function applyTheme(settings: ThemeSettings, root: HTMLElement = document.documentElement): ThemeAttrs {
  const attrs = themeAttrs(settings)
  applyThemeAttrs(attrs, root)
  try {
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(attrs))
  } catch {
    // Storage blocked or full: the theme still applies; the next start paints dark first.
  }
  return attrs
}

/** The theme on `<html>` now (`dark` when none is set: tokens.css's default). */
export function currentThemeName(root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement): ThemeName {
  const t = root?.getAttribute('data-theme')
  return t && (THEME_NAMES as readonly string[]).includes(t) ? (t as ThemeName) : 'dark'
}

function subscribe(onChange: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  const obs = new MutationObserver(onChange)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
  return () => obs.disconnect()
}

/** The current theme name; re-renders when `<html>`'s `data-theme` changes. */
export function useThemeName(): ThemeName {
  return useSyncExternalStore(subscribe, () => currentThemeName(), () => 'dark')
}
