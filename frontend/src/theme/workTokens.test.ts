// M23 Task 17: the work tokens are Object's label tokens, so all four themes follow them.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const dir = `${process.cwd()}/src`
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const tokensCss = strip(readFileSync(`${dir}/theme/tokens.css`, 'utf8'))
const themesCss = strip(readFileSync(`${dir}/theme/themes.css`, 'utf8'))

/** Every custom property set in the blocks whose selector is exactly `selector`. */
function props(css: string, selector: string): Map<string, string> {
  const out = new Map<string, string>()
  let at = css.indexOf(`${selector} {`)
  while (at >= 0) {
    const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('\n}', at))
    for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out.set(m[1], m[2].trim())
    at = css.indexOf(`${selector} {`, at + 1)
  }
  return out
}

const EXPECTED: Record<string, string> = {
  '--work-you': '--label-text-indigo',
  '--work-you-bg': '--label-bg-indigo',
  '--work-agent': '--label-text-teal',
  '--work-agent-bg': '--label-bg-teal',
  '--work-others': '--label-text-gray',
  '--work-others-bg': '--label-bg-gray',
  '--work-approve': '--label-text-amber',
  '--work-high': '--label-text-amber',
  '--work-critical': '--label-text-red',
  '--work-ok': '--label-text-green',
  '--work-capture': '--label-text-pink',
  '--work-capture-bg': '--label-bg-pink',
}

describe('work tokens', () => {
  test('test each work token is a label token every theme defines', () => {
    const root = props(tokensCss, ':root')
    const themes = ['light', 'lightDimmed', 'darkDimmed'].map((t) => [t, props(themesCss, `html[data-theme='${t}']`)] as const)
    for (const [token, label] of Object.entries(EXPECTED)) {
      expect(root.get(token), token).toBe(`var(${label})`)
      expect(root.has(label), `${label} in tokens.css`).toBe(true)
      for (const [name, theme] of themes) expect(theme.has(label), `${label} in ${name}`).toBe(true)
    }
    // No other work token, and none redefined per theme.
    expect([...root.keys()].filter((k) => k.startsWith('--work-')).sort()).toEqual(Object.keys(EXPECTED).sort())
    for (const [name, theme] of themes) expect([...theme.keys()].filter((k) => k.startsWith('--work-')), name).toEqual([])
  })

  test('test work.css is imported and holds the calm, vanish and print rules', () => {
    const index = readFileSync(`${dir}/index.css`, 'utf8')
    expect(index).toContain('@import "./work/work.css";')
    const work = strip(readFileSync(`${dir}/work/work.css`, 'utf8'))
    expect(work).toMatch(/html\[data-work-calm\] aside\[aria-label='Sidebar'\]/)
    expect(work).toMatch(/opacity: 0\.35;/)
    expect(work).toMatch(/opacity 150ms/)
    expect(work).toMatch(/\[data-work-vanish\] \{/)
    expect(work).toMatch(/opacity 200ms/)
    expect(work).toMatch(/@media print \{[\s\S]*\[data-work-print\]/)
  })
})
