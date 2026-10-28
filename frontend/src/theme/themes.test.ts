// Light, Light Dimmed and Dark Dimmed (themes.css) against the dark default (tokens.css) and
// Capacities' themes.ts + colors.ts, through the M7 plan's token table.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { THEME_COLORS } from './palette'

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

// colors.ts values used below.
const gray = {
  0: 'oklch(1.0000 0.0001 263.28)',
  25: 'oklch(0.9916 0.0016 67.00)',
  50: 'oklch(0.9856 0.0016 67.00)',
  100: 'oklch(0.9676 0.0016 67.02)',
  125: 'oklch(0.9556 0.0016 67.03)',
  150: 'oklch(0.9406 0.0016 67.05)',
  200: 'oklch(0.9163 0.0017 67.07)',
  300: 'oklch(0.8643 0.0017 67.13)',
  400: 'oklch(0.7161 0.0060 30.59)',
  450: 'oklch(0.6441 0.0061 30.65)',
  500: 'oklch(0.5725 0.0051 33.89)',
  600: 'oklch(0.4668 0.0039 16.75)',
  675: 'oklch(0.4098 0.0033 286.02)',
  700: 'oklch(0.3887 0.0052 301.05)',
  725: 'oklch(0.3688 0.0051 286.01)',
  750: 'oklch(0.3461 0.0069 285.94)',
  775: 'oklch(0.3226 0.0070 285.92)',
  800: 'oklch(0.2987 0.0072 285.88)',
  825: 'oklch(0.2780 0.0055 285.95)',
  850: 'oklch(0.2574 0.0056 285.92)',
  900: 'oklch(0.2191 0.0058 285.84)',
} as const
const colourTone = (name: string, tone: number): string => {
  const src = readFileSync(`${process.cwd()}/../reference/recovered-ts/src/shared-ui/styles/colors.ts`, 'utf8')
  const body = src.slice(src.indexOf(`  ${name}: {`))
  const m = body.slice(0, body.indexOf('  },')).match(new RegExp(`\\b${tone}: '([^']+)'`))
  if (!m) throw new Error(`no ${name} ${tone}`)
  return m[1]
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

  test('test light token values follow themes.ts', () => {
    const light = theme('light')
    const lightDimmed = theme('lightDimmed')
    const darkDimmed = theme('darkDimmed')
    // The plan's spot checks.
    expect(light.get('--bg-panel')).toBe(gray[0])
    expect(light.get('--bg-app')).toBe(gray[50])
    expect(light.get('--text')).toBe(gray[900])
    expect(lightDimmed.get('--bg-panel')).toBe(gray[25])
    expect(darkDimmed.get('--bg-panel')).toBe(gray[850])

    // One token per mapping row (light / light dimmed / dark dimmed).
    const rows: [string, string, string, string][] = [
      ['--bg-app', gray[50], gray[100], gray[900]],
      ['--bg-raised', gray[0], gray[0], gray[825]],
      ['--bg-raised-2', gray[100], gray[125], gray[725]],
      ['--bg-hover', gray[50], gray[50], gray[775]],
      ['--bg-hover-2', gray[150], gray[150], gray[700]],
      ['--border-subtle', gray[200], gray[200], gray[725]],
      ['--text', gray[900], gray[750], gray[200]],
      ['--text-muted', gray[500], gray[450], gray[450]],
      ['--primary-btn', gray[700], gray[675], gray[200]],
      ['--primary-btn-text', gray[100], gray[125], gray[800]],
      ['--text-section', gray[500], gray[450], gray[450]],
      ['--chrome-btn-border', gray[200], gray[200], gray[700]],
      ['--float-bg', 'var(--bg-raised)', 'var(--bg-raised)', 'var(--bg-raised)'],
      ['--float-border', 'var(--border-subtle)', 'var(--border-subtle)', 'var(--border-subtle)'],
      ['--float-btn-border', 'var(--chrome-btn-border)', 'var(--chrome-btn-border)', 'var(--chrome-btn-border)'],
      ['--block-selection-bg', '#4494f748', '#4494f748', '#5090dd3a'],
      ['--block-selection-border', colourTone('blue', 400), colourTone('blue', 400), colourTone('blue', 400)],
      ['--editor-bullet', gray[500], gray[500], 'oklch(0.8643 0.0017 67.13)'],
      ['--editor-quote-line', gray[400], gray[400], gray[400]],
      ['--editor-hr', gray[300], gray[300], gray[600]],
      ['--editor-toggle', gray[700], gray[700], 'oklch(0.9163 0.0017 67.07)'],
      ['--code-bg', gray[25], gray[100], gray[775]],
      ['--code-border', gray[200], gray[150], gray[725]],
      ['--code-text', gray[900], gray[825], 'oklch(0.9163 0.0017 67.07)'],
      ['--type-blue-fg', colourTone('blue', 650), colourTone('blue', 650), colourTone('blue', 200)],
      ['--type-gray-bg', gray[50], gray[50], gray[775]],
      ['--tag-bg-teal', colourTone('teal', 100), colourTone('teal', 100), colourTone('teal', 800)],
      ['--tag-text-gray', gray[800], gray[800], 'oklch(0.9676 0.0016 67.02)'],
      ['--label-bg-red', colourTone('red', 50), colourTone('red', 50), colourTone('red', 850)],
      ['--label-bg-gray', gray[50], gray[100], gray[800]],
      ['--label-text-gray', gray[600], gray[600], gray[500]],
      ['--label-border-rose', colourTone('rose', 300), colourTone('rose', 300), colourTone('rose', 500)],
      ['--line-green', colourTone('green', 500), colourTone('green', 500), colourTone('green', 400)],
    ]
    for (const [token, l, ld, dd] of rows) {
      expect([light.get(token), lightDimmed.get(token), darkDimmed.get(token)], token).toEqual([l, ld, dd])
    }
    expect(light.get('--border-chrome')).toBe(`color-mix(in srgb, ${gray[200]} 80%, ${gray[50]})`)
    // The same in every theme.
    for (const t of THEMES) {
      expect(theme(t).get('--danger')).toBe(dark.get('--danger'))
      expect(theme(t).get('--accent-today')).toBe(dark.get('--accent-today'))
      expect(theme(t).get('--card-shadow')).toBe(dark.get('--card-shadow'))
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

  test('test existing dark token values are unchanged', () => {
    // Regression guard (green from the start): tokens.css's :root as it was before Task 16.
    const BASELINE = `
--bg-app: #0d0c10
--bg-panel: #151418
--bg-raised: #1a1a1d
--bg-raised-2: #212024
--bg-hover: #232326
--bg-hover-2: #28272b
--border-subtle: #2d2c31
--danger: #cd1e46
--text: #f4f4f5
--text-muted: #9a9aa0
--accent-today: #ff0000
--primary-btn: #e8e7e6
--primary-btn-text: #232326
--text-section: #a7a2a1
--chrome-btn-border: #2a292d
--float-bg: #18181b
--float-border: #232226
--float-btn-border: #29282d
--card-shadow: 0 2px 3px #00000001, 0 4px 9px #00000003, 0 8px 12px #00000001
--block-selection-bg: #5090dd3a
--block-selection-border: #60a5fa
--text-selection-bg: #5090dd3a
--editor-bullet: #e4e3e2
--editor-bullet-nested: #7c7c7d
--editor-quote-line: #4e4b4c
--editor-hr: var(--border-subtle)
--editor-toggle: #e4e3e2
--editor-toggle-empty: #7b7776
--editor-toggle-outline: #5c5959
--code-bg: #28282b
--code-border: #333337
--code-text: #e4e3e2
--border-chrome: #27262b
--type-blue-fg: #c0d8ff
--type-blue-bg: #323458
--type-green-fg: #b1ffd2
--type-green-bg: #1f4430
--type-orange-fg: #fed8a5
--type-orange-bg: #553025
--type-purple-fg: #eecaff
--type-purple-bg: #491f57
--type-pink-fg: #ffc5d0
--type-pink-bg: #5d1e37
--type-teal-fg: #b1f6ff
--type-teal-bg: #1f4346
--type-yellow-fg: #fff0a8
--type-yellow-bg: #4f4420
--type-red-fg: #ffc2c7
--type-red-bg: #59282d
--type-gray-fg: #e4e3e2
--type-gray-bg: #3c3b3e
--type-rose-fg: #ffbdc7
--type-rose-bg: #52282f
--type-fuchsia-fg: #f7bdff
--type-fuchsia-bg: #4d2852
--type-violet-fg: #cfbdff
--type-violet-bg: #342852
--type-indigo-fg: #bdc0ff
--type-indigo-bg: #282b52
--type-sky-fg: #bdeaff
--type-sky-bg: #284552
--type-cyan-fg: #bdf6ff
--type-cyan-bg: #284c52
--type-emerald-fg: #bdffe8
--type-emerald-bg: #285244
--type-lime-fg: #e6ffbd
--type-lime-bg: #425228
--type-amber-fg: #ffeabd
--type-amber-bg: #524528
--tag-bg-gray: #333337
--tag-text-gray: #f5f4f3
--tag-bg-rose: #742c40
--tag-text-rose: #fff1f2
--tag-bg-pink: #742f4b
--tag-text-pink: #fdf2f8
--tag-bg-fuchsia: #632c67
--tag-text-fuchsia: #fdf4ff
--tag-bg-purple: #5c377a
--tag-text-purple: #faf5ff
--tag-bg-violet: #573a85
--tag-text-violet: #f5f3ff
--tag-bg-indigo: #434078
--tag-text-indigo: #eef2ff
--tag-bg-blue: #35467d
--tag-text-blue: #eff6ff
--tag-bg-sky: #1d455a
--tag-text-sky: #f0f9ff
--tag-bg-cyan: #22434d
--tag-text-cyan: #ecfeff
--tag-bg-teal: #1f4644
--tag-text-teal: #f0fdfa
--tag-bg-emerald: #184739
--tag-text-emerald: #ecfdf5
--tag-bg-green: #265237
--tag-text-green: #f0fdf4
--tag-bg-lime: #34451e
--tag-text-lime: #f7fee7
--tag-bg-yellow: #5f4323
--tag-text-yellow: #fefce8
--tag-bg-amber: #704429
--tag-text-amber: #fffbeb
--tag-bg-orange: #733d2c
--tag-text-orange: #fff7ed
--tag-bg-red: #723131
--tag-text-red: #fef2f2
--label-bg-gray: #28282b
--label-text-gray: #7b7776
--label-bg-rose: #672d3d
--label-text-rose: #f45a73
--label-bg-pink: #662f45
--label-text-pink: #ec5fa7
--label-bg-fuchsia: #562c59
--label-text-fuchsia: #de62f0
--label-bg-purple: #513469
--label-text-purple: #b26ef6
--label-bg-violet: #4f3773
--label-text-violet: #9975f4
--label-bg-indigo: #3e3c67
--label-text-indigo: #7279f1
--label-bg-blue: #334069
--label-text-blue: #4f93f3
--label-bg-sky: #1f3d4e
--label-text-sky: #26aeeb
--label-bg-cyan: #213a43
--label-text-cyan: #19bed8
--label-bg-teal: #1f3e3c
--label-text-teal: #25c0af
--label-bg-emerald: #183e33
--label-text-emerald: #26c18b
--label-bg-green: #254833
--label-text-green: #3ace70
--label-bg-lime: #2f3d1e
--label-text-lime: #92d22a
--label-bg-yellow: #543c24
--label-text-yellow: #ecbc13
--label-bg-amber: #633f2a
--label-text-amber: #f2ad1d
--label-bg-orange: #63392b
--label-text-orange: #f4832d
--label-bg-red: #643131
--label-text-red: #f05d5d
--label-border-gray: #636060
--line-gray: #5c5959
--label-border-rose: #ea4561
--line-rose: var(--label-border-rose)
--label-border-pink: #e34d97
--line-pink: var(--label-border-pink)
--label-border-fuchsia: #d14be5
--line-fuchsia: var(--label-border-fuchsia)
--label-border-purple: #a558ee
--line-purple: var(--label-border-purple)
--label-border-violet: #8a5fed
--line-violet: var(--label-border-violet)
--label-border-indigo: #6568e8
--line-indigo: var(--label-border-indigo)
--label-border-blue: #3f80eb
--line-blue: var(--label-border-blue)
--label-border-sky: #199dd9
--line-sky: var(--label-border-sky)
--label-border-cyan: #11a9c3
--line-cyan: var(--label-border-cyan)
--label-border-teal: #1dad9d
--line-teal: var(--label-border-teal)
--label-border-emerald: #19ae7d
--line-emerald: var(--label-border-emerald)
--label-border-green: #2bbb60
--line-green: var(--label-border-green)
--label-border-lime: #7fbe1f
--line-lime: var(--label-border-lime)
--label-border-yellow: #daaa14
--line-yellow: var(--label-border-yellow)
--label-border-amber: #e89a17
--line-amber: var(--label-border-amber)
--label-border-orange: #ec731f
--line-orange: var(--label-border-orange)
--label-border-red: #e54a4a
--line-red: var(--label-border-red)
--radius-xs-v: 2px
--radius-sm-v: 4px
--radius-md-v: 6px
--radius-lg-v: 8px
--radius-xl-v: 12px
--radius-2xl-v: 16px
--radius-3xl-v: 24px
--object-font-sans-serif: "Inter", ui-sans-serif, system-ui, sans-serif
--object-font-serif: Georgia, serif
--object-font-monospace: "Courier New", monospace
--page-content-width: 820px
--cover-crop-height: 240px
--profile-image-size: 132px
--profile-column-width: 280px
--infobox-width: 300px`
    for (const line of BASELINE.trim().split('\n')) {
      const at = line.indexOf(': ')
      const name = line.slice(0, at)
      expect(dark.get(name), name).toBe(line.slice(at + 2))
    }
  })
})
