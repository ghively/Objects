/**
 * M33: the desktop window follows the app's theme. The app writes its theme on `<html>`
 * (`theme/applyTheme.ts`: `data-theme` and the `dark` class; `index.html` does the same before the
 * first paint) and `useThemeName` re-renders when that changes. Here, inside the shell, each
 * change (and the start) tells the window the mode and the top bar's own colours as it is painted
 * now, so the system's parts match: the Windows button colours, the window's background, the
 * system's light or dark. Nothing about how the theme is applied changes.
 */
import { useEffect, useRef } from 'react'
import { useThemeName } from '@/theme/applyTheme'
import { desktop } from './bridge'

export interface WindowTheme {
  mode: 'light' | 'dark'
  background: string
  foreground: string
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')

/**
 * A computed CSS colour as `#rrggbb`: the `rgb` / `rgba` functions (commas or spaces), `color(srgb …)`
 * and hex itself. Null for nothing, a fully transparent colour and anything else.
 */
export function cssHex(value: string): string | null {
  const v = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(v)) return v
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  const fn = /^(rgba?|color)\((.*)\)$/.exec(v)
  if (!fn) return null
  const srgb = fn[1] === 'color'
  if (srgb && !fn[2].startsWith('srgb ')) return null
  const parts = (srgb ? fn[2].slice(5) : fn[2]).split(/[\s,/]+/).filter(Boolean).map(Number)
  if (parts.length < 3 || parts.some(Number.isNaN)) return null
  if (parts.length > 3 && parts[3] === 0) return null
  const [r, g, b] = srgb ? parts.map((n) => n * 255) : parts
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`
}

/**
 * The window's theme now: the mode on `<html>` and the top bar's computed colours (the page's
 * where there is no top bar). Null when a colour cannot be read: nothing is guessed.
 */
export function topBarTheme(doc: Document = document): WindowTheme | null {
  const bar = doc.querySelector('.app-titlebar')
  let background: string | null = null
  let foreground: string | null = null
  for (const el of [bar, doc.body, doc.documentElement]) {
    if (!el) continue
    const cs = getComputedStyle(el)
    background ??= cssHex(cs.backgroundColor)
    foreground ??= cssHex(cs.color)
  }
  if (!background || !foreground) return null
  return { mode: doc.documentElement.classList.contains('dark') ? 'dark' : 'light', background, foreground }
}

/** Mounted once (`DesktopChrome`): tells the shell the theme at start and whenever it changes. */
export function useWindowTheme(): void {
  const theme = useThemeName()
  const sent = useRef('')
  useEffect(() => {
    const d = desktop()
    if (!d) return
    const t = topBarTheme()
    if (!t) return
    const key = `${t.mode} ${t.background} ${t.foreground}`
    if (key === sent.current) return
    sent.current = key
    d.setTheme(t)
  }, [theme])
}
