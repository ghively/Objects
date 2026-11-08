// Light, Light Dimmed and Dark Dimmed (themes.css) against the dark default (tokens.css), and every
// theme's colours against the Tailwind palette rules in themes.css's header.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { THEME_COLORS } from './palette'
import { TAILWIND, mixHex } from './tailwindPalette'

const dir = `${process.cwd()}/src/theme`
const tokensCss = readFileSync(`${dir}/tokens.css`, 'utf8')
const themesCss = readFileSync(`${dir}/themes.css`, 'utf8')

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The custom properties of the first block whose selector is exactly `selector`. */
function block(css: string, selector: string): Map<string, string> {
  const src = strip(css)
  const at = src.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`no block ${selector}`)
  const body = src.slice(src.indexOf('{', at) + 1, src.indexOf('\n}', at))
  const out = new Map<string, string>()
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out.set(m[1], m[2].trim())
  return out
}

const dark = block(tokensCss, ':root')
const THEMES = ['light', 'lightDimmed', 'darkDimmed'] as const
const theme = (t: (typeof THEMES)[number]) => block(themesCss, `html[data-theme='${t}']`)

/** Layout and font tokens: the same in every theme, so the theme blocks leave them alone. */
const NOT_COLOUR = /^--(radius-|object-font-|app-font$|page-content-width$|cover-crop-height$|profile-|infobox-width$)/

const stone = TAILWIND.stone
const zinc = TAILWIND.zinc
const HUES = THEME_COLORS.filter((c) => c !== 'gray')

/** themes.css's per-hue rule (its header) for one theme. */
function hueTokens(t: 'dark' | (typeof THEMES)[number], h: (typeof HUES)[number]): Record<string, string> {
  const c = TAILWIND[h]
  if (t === 'light' || t === 'lightDimmed') {
    return {
      [`--type-${h}-fg`]: c[700],
      [`--type-${h}-bg`]: c[50],
      [`--tag-bg-${h}`]: c[100],
      [`--tag-text-${h}`]: c[800],
      [`--label-bg-${h}`]: c[50],
      [`--label-text-${h}`]: c[600],
      [`--label-border-${h}`]: c[300],
      [`--line-${h}`]: c[500],
    }
  }
  const s = t === 'dark' ? zinc[900] : zinc[800]
  return {
    [`--type-${h}-fg`]: c[200],
    [`--type-${h}-bg`]: mixHex(c[900], s, 0.45),
    [`--tag-bg-${h}`]: mixHex(c[800], s, 0.55),
    [`--tag-text-${h}`]: c[50],
    [`--label-bg-${h}`]: mixHex(c[950], s, 0.5),
    [`--label-text-${h}`]: c[400],
    [`--label-border-${h}`]: c[500],
    [`--line-${h}`]: `var(--label-border-${h})`,
  }
}

describe('themes', () => {
  test('test every dark token is defined in every theme', () => {
    const colourTokens = [...dark.keys()].filter((k) => !NOT_COLOUR.test(k))
    expect(colourTokens.length).toBeGreaterThan(180)
    for (const t of THEMES) {
      const tokens = theme(t)
      const missing = colourTokens.filter((k) => !tokens.has(k))
      expect(missing, t).toEqual([])
    }
  })

  test('test colour tokens follow the palette rules', () => {
    const blocks = { dark, light: theme('light'), lightDimmed: theme('lightDimmed'), darkDimmed: theme('darkDimmed') }
    for (const [name, b] of Object.entries(blocks)) {
      for (const h of HUES) {
        for (const [token, value] of Object.entries(hueTokens(name as keyof typeof blocks, h))) {
          expect(b.get(token), `${name} ${token}`).toBe(value)
        }
      }
      expect(b.get('--border-chrome'), name).toBe(mixHex(b.get('--border-subtle')!, b.get('--bg-app')!, 0.6))
    }

    // Surfaces and text, one row per token (dark / light / light dimmed / dark dimmed).
    const rows: [string, string, string, string, string][] = [
      ['--bg-app', zinc[950], stone[50], stone[100], zinc[900]],
      ['--bg-panel', mixHex(zinc[900], zinc[950], 0.5), '#ffffff', stone[50], mixHex(zinc[800], zinc[900], 0.35)],
      ['--bg-raised', zinc[900], '#ffffff', '#ffffff', zinc[800]],
      ['--border-subtle', zinc[800], stone[200], stone[200], zinc[700]],
      ['--text', zinc[100], stone[900], stone[800], zinc[200]],
      ['--text-muted', zinc[400], stone[500], stone[500], zinc[400]],
      ['--primary-btn', zinc[200], stone[800], stone[700], zinc[200]],
      ['--code-text', zinc[200], stone[800], stone[800], zinc[200]],
      ['--float-bg', 'var(--bg-raised)', 'var(--bg-raised)', 'var(--bg-raised)', 'var(--bg-raised)'],
      ['--float-border', 'var(--border-subtle)', 'var(--border-subtle)', 'var(--border-subtle)', 'var(--border-subtle)'],
      ['--block-selection-border', TAILWIND.blue[400], TAILWIND.blue[400], TAILWIND.blue[400], TAILWIND.blue[400]],
      ['--block-selection-bg', `${TAILWIND.blue[500]}40`, `${TAILWIND.blue[500]}33`, `${TAILWIND.blue[500]}33`, `${TAILWIND.blue[500]}40`],
      ['--type-gray-fg', zinc[200], stone[700], stone[700], zinc[200]],
      ['--tag-text-gray', zinc[50], stone[800], stone[800], zinc[50]],
      ['--label-bg-gray', zinc[800], stone[50], stone[100], zinc[700]],
      ['--label-text-gray', zinc[400], stone[600], stone[600], zinc[400]],
      ['--danger', TAILWIND.rose[600], TAILWIND.rose[600], TAILWIND.rose[600], TAILWIND.rose[600]],
      ['--accent-today', TAILWIND.red[500], TAILWIND.red[500], TAILWIND.red[500], TAILWIND.red[500]],
      ['--warning', TAILWIND.amber[400], TAILWIND.amber[600], TAILWIND.amber[600], TAILWIND.amber[400]],
    ]
    for (const [token, d, l, ld, dd] of rows) {
      expect([dark.get(token), blocks.light.get(token), blocks.lightDimmed.get(token), blocks.darkDimmed.get(token)], token).toEqual([d, l, ld, dd])
    }
    for (const t of THEMES) expect(theme(t).get('--card-shadow')).toBe(dark.get('--card-shadow'))

    // Every literal colour is a palette step, white, a mix the rules name, or a step with alpha.
    const steps = new Set<string>(Object.values(TAILWIND).flatMap((f) => Object.values(f)))
    for (const [name, b] of Object.entries(blocks)) {
      for (const [token, value] of b) {
        if (NOT_COLOUR.test(token) || !value.startsWith('#')) continue
        const plain = value.slice(0, 7)
        const isMix = /^--(bg-(panel|raised-2|hover|hover-2)|border-chrome|code-bg|type-.*-bg|tag-bg-.*|label-bg-.*)$/.test(token)
        expect(steps.has(plain) || plain === '#ffffff' || isMix, `${name} ${token} ${value}`).toBe(true)
      }
    }

    // color-scheme follows the theme's type.
    const scheme = (t: string) => strip(themesCss).match(new RegExp(`html\\[data-theme='${t}'\\] \\{[^}]*color-scheme: (\\w+);`))?.[1]
    expect([scheme('light'), scheme('lightDimmed'), scheme('darkDimmed')]).toEqual(['light', 'light', 'dark'])
  })

  test('test monochrome and font overrides', () => {
    const tags = block(themesCss, 'html[data-mono-tags]')
    const types = block(themesCss, 'html[data-mono-type-labels]')
    for (const c of THEME_COLORS.filter((c) => c !== 'gray')) {
      expect(tags.get(`--tag-bg-${c}`)).toBe('var(--tag-bg-gray)')
      expect(tags.get(`--tag-text-${c}`)).toBe('var(--tag-text-gray)')
      expect(types.get(`--type-${c}-fg`)).toBe('var(--type-gray-fg)')
      expect(types.get(`--type-${c}-bg`)).toBe('var(--type-gray-bg)')
    }
    // After the theme blocks, so they win at equal specificity.
    expect(themesCss.indexOf('html[data-mono-tags]')).toBeGreaterThan(themesCss.lastIndexOf("html[data-theme="))
    expect(block(themesCss, "html[data-font='serif']").get('--app-font')).toBe('var(--object-font-serif)')
    expect(block(themesCss, "html[data-font='monospace']").get('--app-font')).toBe('var(--object-font-monospace)')
    expect(dark.get('--app-font')).toBe('var(--object-font-sans-serif)')
    expect(strip(tokensCss)).toMatch(/body \{[^}]*font-family: var\(--app-font\);/)
  })

  test('test search and find-in-page highlights are set in all four themes', () => {
    // Light: yellow-200 at 40% with yellow-900 text; dark: yellow-300 at 20% with yellow-100 text.
    // ::highlight(find-in-page) yellow-400 at 50%, find-in-page-active orange-500 at 65%.
    const y = TAILWIND.yellow
    const expected = {
      dark: [`${y[300]}33`, y[100]],
      darkDimmed: [`${y[300]}33`, y[100]],
      light: [`${y[200]}66`, y[900]],
      lightDimmed: [`${y[200]}66`, y[900]],
    } as const
    const blocks = { dark, light: theme('light'), lightDimmed: theme('lightDimmed'), darkDimmed: theme('darkDimmed') }
    for (const [name, [bg, text]] of Object.entries(expected)) {
      const b = blocks[name as keyof typeof blocks]
      expect(b.get('--bg-search-highlight'), name).toBe(bg)
      expect(b.get('--text-search-highlight'), name).toBe(text)
      expect(b.get('--bg-find-match'), name).toBe(`${y[400]}80`)
      expect(b.get('--bg-find-match-current'), name).toBe(`${TAILWIND.orange[500]}a6`)
      expect(b.has('--bg-search-highlight-current'), name).toBe(false)
    }
    const index = readFileSync(`${process.cwd()}/src/index.css`, 'utf8')
    expect(index).toMatch(/\.search-highlights-bold b \{\s*font-weight: 600;/)
    expect(index).toMatch(/\.find-match \{\s*background-color: var\(--bg-find-match\);\s*color: inherit;/)
    expect(index).toMatch(/\.find-match-current \{\s*background-color: var\(--bg-find-match-current\);\s*color: inherit;/)
  })
})
