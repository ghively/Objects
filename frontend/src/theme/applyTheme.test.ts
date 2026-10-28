import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import indexHtml from '../../index.html?raw'
import { settingsDefaults } from '@/settings/defaults'
import { applyTheme, THEME_CACHE_KEY, themeAttrs, useThemeName } from './applyTheme'

const root = () => document.documentElement

function reset() {
  const h = root()
  for (const a of ['data-theme', 'data-mono-tags', 'data-mono-type-labels', 'data-font']) h.removeAttribute(a)
  h.className = 'dark'
  localStorage.clear()
}

/** index.html's inline first-paint script, run against this document. */
function runFirstPaint() {
  const m = indexHtml.match(/<script>([\s\S]*?)<\/script>/)
  expect(m).not.toBeNull()
  new Function(m![1])()
}

afterEach(reset)

describe('applyTheme', () => {
  test('test theme attribute and dark class follow settings', () => {
    const cases = [
      [{ themeMode: 'dark', darkTheme: 'dark' }, 'dark', true],
      [{ themeMode: 'dark', darkTheme: 'darkDimmed' }, 'darkDimmed', true],
      [{ themeMode: 'light', lightTheme: 'light' }, 'light', false],
      [{ themeMode: 'light', lightTheme: 'lightDimmed' }, 'lightDimmed', false],
    ] as const
    for (const [patch, theme, dark] of cases) {
      applyTheme({ ...settingsDefaults, ...patch })
      expect(root().getAttribute('data-theme')).toBe(theme)
      expect(root().classList.contains('dark')).toBe(dark)
    }

    // Monochrome flags and fonts.
    applyTheme({ ...settingsDefaults, monochromeTags: true, monochromeTypeLabels: true, font: 'serif' })
    expect(root().hasAttribute('data-mono-tags')).toBe(true)
    expect(root().hasAttribute('data-mono-type-labels')).toBe(true)
    expect(root().getAttribute('data-font')).toBe('serif')
    applyTheme({ ...settingsDefaults, font: 'monospace' })
    expect(root().hasAttribute('data-mono-tags')).toBe(false)
    expect(root().hasAttribute('data-mono-type-labels')).toBe(false)
    expect(root().getAttribute('data-font')).toBe('monospace')

    // The light theme choice is kept while dark is on, and an unknown value falls back.
    expect(themeAttrs({ ...settingsDefaults, themeMode: 'dark', lightTheme: 'lightDimmed' }).theme).toBe('dark')
    expect(themeAttrs({ ...settingsDefaults, themeMode: 'light', lightTheme: 'sepia' as never }).theme).toBe('light')

    // A custom root, and the cache for the next first paint.
    const el = document.createElement('div')
    applyTheme({ ...settingsDefaults, themeMode: 'light' }, el)
    expect(el.getAttribute('data-theme')).toBe('light')
    expect(JSON.parse(localStorage.getItem(THEME_CACHE_KEY)!)).toEqual({
      theme: 'light',
      dark: false,
      monoTags: false,
      monoTypeLabels: false,
      font: 'sans-serif',
    })
  })

  test('test first paint applies the cached theme', () => {
    expect(indexHtml).toContain('<html lang="en" class="dark">')
    // No cache: the dark default stays.
    runFirstPaint()
    expect(root().hasAttribute('data-theme')).toBe(false)
    expect(root().classList.contains('dark')).toBe(true)

    // An unreadable cache changes nothing either.
    localStorage.setItem(THEME_CACHE_KEY, '{not json')
    runFirstPaint()
    expect(root().classList.contains('dark')).toBe(true)

    // A cached theme sets exactly what applyTheme would.
    applyTheme({ ...settingsDefaults, themeMode: 'light', lightTheme: 'lightDimmed', monochromeTags: true, font: 'monospace' })
    const expected = {
      theme: root().getAttribute('data-theme'),
      cls: root().className,
      mono: root().hasAttribute('data-mono-tags'),
      monoTypes: root().hasAttribute('data-mono-type-labels'),
      font: root().getAttribute('data-font'),
    }
    const cache = localStorage.getItem(THEME_CACHE_KEY)
    reset()
    localStorage.setItem(THEME_CACHE_KEY, cache!)
    runFirstPaint()
    expect({
      theme: root().getAttribute('data-theme'),
      cls: root().className,
      mono: root().hasAttribute('data-mono-tags'),
      monoTypes: root().hasAttribute('data-mono-type-labels'),
      font: root().getAttribute('data-font'),
    }).toEqual(expected)
    expect(expected).toEqual({ theme: 'lightDimmed', cls: '', mono: true, monoTypes: false, font: 'monospace' })
  })

  test('test useThemeName follows data-theme', async () => {
    const { result } = renderHook(() => useThemeName())
    expect(result.current).toBe('dark')
    await act(async () => {
      applyTheme({ ...settingsDefaults, themeMode: 'light' })
      await Promise.resolve()
    })
    expect(result.current).toBe('light')
  })
})
