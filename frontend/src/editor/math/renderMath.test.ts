import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'
import { displayMathRows, renderDisplayMath, renderMath } from './renderMath'

describe('renderMath', () => {
  test('renders display and inline formulas with HTML and MathML', () => {
    const display = renderMath('E = mc^2', { display: true })
    expect(display).toContain('katex-display')
    expect(display).toContain('<math')
    const inline = renderMath('a^2', { display: false })
    expect(inline).not.toContain('katex-display')
    expect(inline).toContain('class="katex"')
  })

  test('renderMath display and inline never throw on bad input', () => {
    for (const bad of ['\\frac{', '\\undefinedmacro{x}', '}', '\\begin{matrix}', '^^^', '\\href{javascript:alert(1)}{x}']) {
      expect(() => renderMath(bad, { display: true })).not.toThrow()
      expect(() => renderMath(bad, { display: false })).not.toThrow()
    }
    // KaTeX's error colouring, not an exception.
    expect(renderMath('\\frac{', { display: true })).toMatch(/katex-error|color/)
  })

  test('trust is off: links and includes stay inert', () => {
    const out = renderMath('\\href{javascript:alert(1)}{x} \\includegraphics{http://example.com/a.png}', { display: false })
    expect(out).not.toMatch(/href\s*=/)
    expect(out).not.toMatch(/src\s*=/)
    expect(out).not.toContain('<img')
    expect(out).not.toContain('<a ')
  })

  test('katex assets are local', () => {
    const require = createRequire(import.meta.url)
    const css = readFileSync(require.resolve('katex/dist/katex.min.css'), 'utf8')
    const urls = Array.from(css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g), (m) => m[1])
    expect(urls.length).toBeGreaterThan(0)
    for (const u of urls) {
      expect(u).not.toMatch(/^(?:[a-z]+:)?\/\//i)
      expect(u).toMatch(/^fonts\//)
    }
    // renderMath.ts imports that very stylesheet, never a CDN copy.
    const source = readFileSync(require.resolve('./renderMath.ts'), 'utf8')
    expect(source).toContain("import 'katex/dist/katex.min.css'")
    expect(source).not.toMatch(/https?:\/\//)
  })
  // Known issue 7: KaTeX ignores a blank line, so two formulas ran together on one line.
  test('a blank line splits display math into rows', () => {
    expect(displayMathRows('E = mc^2\n\na^2+b^2=c^2')).toEqual(['E = mc^2', 'a^2+b^2=c^2'])
    expect(displayMathRows('a\n \t\n\n\nb\n\nc')).toEqual(['a', 'b', 'c'])
    expect(displayMathRows('a\nb')).toEqual(['a\nb'])
    expect(displayMathRows('\n\nx\n\n')).toEqual(['x'])
    // A blank line inside a group or an environment does not split it.
    expect(displayMathRows('\\begin{aligned}\na &= b\n\nc &= d\n\\end{aligned}\n\ne')).toEqual([
      '\\begin{aligned}\na &= b\n\nc &= d\n\\end{aligned}',
      'e',
    ])
    expect(displayMathRows('\\frac{a\n\nb}{c}')).toEqual(['\\frac{a\n\nb}{c}'])
    expect(displayMathRows('\\{a\n\nb')).toEqual(['\\{a', 'b'])
    const html = renderDisplayMath('E = mc^2\n\na^2+b^2=c^2')
    expect(html.match(/class="katex-display"/g)).toHaveLength(2)
    expect(renderDisplayMath('E = mc^2').match(/class="katex-display"/g)).toHaveLength(1)
  })
})
