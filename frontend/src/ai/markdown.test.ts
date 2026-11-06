import { beforeAll, describe, expect, test } from 'vitest'
import { loadGrammar } from '@/editor/code/highlight'
import { loadMath } from '@/editor/math/renderMath'
import { assertInert, fenceLanguages, MAX_RENDER_CHARS, renderChatMarkdown } from './markdown'

function dom(source: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = renderChatMarkdown(source)
  return host
}

beforeAll(async () => {
  await loadMath()
  await loadGrammar('python')
})

describe('renderChatMarkdown (M16)', () => {
  test('test headings, emphasis, strikethrough', () => {
    expect(dom('# A').querySelector('h1')).toHaveTextContent('A')
    const el = dom('**b** *i* ~~s~~')
    expect(el.querySelector('strong')).toHaveTextContent('b')
    expect(el.querySelector('em')).toHaveTextContent('i')
    expect(el.querySelector('del')).toHaveTextContent('s')
  })

  test('test lists and task lists', () => {
    const ul = dom('- a\n- b').querySelector('ul')!
    expect(ul.querySelectorAll('li')).toHaveLength(2)
    expect(dom('1. a').querySelector('ol')).not.toBeNull()
    const boxes = dom('- [x] done\n- [ ] todo').querySelectorAll<HTMLInputElement>('input[type=checkbox][disabled]')
    expect(boxes).toHaveLength(2)
    expect(boxes[0].checked).toBe(true)
    expect(boxes[1].checked).toBe(false)
  })

  test('test tables, quotes and rules', () => {
    const table = dom('| a | b |\n|---|---|\n| 1 | 2 |').querySelector('table')!
    expect(table.querySelectorAll('th')).toHaveLength(2)
    expect(table.querySelectorAll('td')).toHaveLength(2)
    expect(dom('> q').querySelector('blockquote')).toHaveTextContent('q')
    expect(dom('a\n\n---\n\nb').querySelector('hr')).not.toBeNull()
  })

  test('test inline code and highlighted fences', () => {
    expect(renderChatMarkdown('`x<y`')).toContain('<code>x&lt;y</code>')
    const py = dom('```python\ndef f(): pass\n```')
    const kw = py.querySelector('pre.chat-code span.hljs-keyword')
    expect(kw).toHaveTextContent('def')
    expect(py.querySelector('pre.chat-code')!.getAttribute('data-language')).toBe('python')
    const plain = dom('```nosuchlang\na < b\n```')
    expect(plain.querySelector('pre.chat-code span')).toBeNull()
    expect(plain.querySelector('pre.chat-code code')!.textContent).toBe('a < b')
  })

  test('test math', () => {
    expect(dom('$x^2$').querySelector('.katex')).not.toBeNull()
    expect(dom('$$\nx\n$$').querySelector('.katex-display')).not.toBeNull()
    const money = dom('$5 and $6')
    expect(money.querySelector('.katex')).toBeNull()
    expect(money).toHaveTextContent('$5 and $6')
    const escaped = dom('costs \\$5 $y$')
    expect(escaped.querySelectorAll('.katex')).toHaveLength(1)
    expect(escaped.textContent).toContain('costs $5 ')
    expect(dom('`$x$`').querySelector('.katex')).toBeNull()
  })

  test('test links', () => {
    for (const src of ['https://example.org', '[e](https://example.org)']) {
      const a = dom(src).querySelector('a')!
      expect(a.getAttribute('href')).toBe('https://example.org')
      expect(a.getAttribute('rel')).toBe('noopener noreferrer')
      expect(a.getAttribute('target')).toBe('_blank')
    }
    const plainChip = dom('[[Alpha]]').querySelector('span[data-wikilink]')!
    expect(plainChip.getAttribute('data-target')).toBe('Alpha')
    expect(plainChip).toHaveTextContent('Alpha')
    const labelled = dom('[[Alpha|A]]').querySelector('span[data-wikilink]')!
    expect(labelled.getAttribute('data-target')).toBe('Alpha')
    expect(labelled.getAttribute('data-label')).toBe('A')
    expect(labelled).toHaveTextContent('A')
    const rel = dom('[Alpha](Servers/Alpha.md)')
    expect(rel.querySelector('a')).toBeNull()
    const relChip = rel.querySelector('span[data-wikilink]')!
    expect(relChip.getAttribute('data-target')).toBe('Servers/Alpha')
    expect(relChip.getAttribute('data-label')).toBe('Alpha')
    expect(dom('[Ada](People/Ada%20Lovelace.md)').querySelector('span[data-wikilink]')!.getAttribute('data-target')).toBe('People/Ada Lovelace')
    expect(dom('[m](mailto:a@example.org)').querySelector('a')!.getAttribute('href')).toBe('mailto:a@example.org')
  })

  test('test a hostile reply renders inert', () => {
    const hostile = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<a href="javascript:alert(1)">x</a>',
      '[x](javascript:alert(1))',
      '[x](JaVaScRiPt:alert(1))',
      '[x](data:text/html,<b>)',
      '- item\n\n  <iframe src="https://example.org"></iframe>',
      '<style>body{display:none}</style>',
      '$\\href{javascript:alert(1)}{x}$',
      '$\\htmlClass{x}{y}$',
      '```"><script>alert(1)</script>\ncode\n```',
      'text <form action="https://example.org"><input name=a></form> more',
    ]
    for (const src of hostile) {
      const html = renderChatMarkdown(src)
      expect(() => assertInert(html), src).not.toThrow()
    }
    expect(dom('<script>alert(1)</script>').textContent).toContain('<script>')
    expect(dom('<img src=x onerror=alert(1)>').textContent).toContain('<img src=x onerror=alert(1)>')
    expect(dom('- item\n\n  <iframe src="https://example.org"></iframe>').textContent).toContain('<iframe')
    expect(dom('<style>body{display:none}</style>').textContent).toContain('<style>')
    expect(dom('[x](javascript:alert(1))')).toHaveTextContent('x')
  })

  test('test assertInert catches live HTML', () => {
    for (const bad of [
      '<script>x</script>',
      '<img src="x">',
      '<b onclick="x">b</b>',
      '<a href="javascript:x">a</a>',
      '<iframe></iframe>',
      '<style></style>',
      '<form></form>',
      '<input type="checkbox">',
      '<span style="background:url(https://example.org/a.png)"></span>',
    ]) {
      expect(() => assertInert(bad), bad).toThrow()
    }
    expect(() => assertInert('<a href="https://example.org">a</a><a href="Servers/A.md">b</a><input type="checkbox" disabled>')).not.toThrow()
  })

  test('test images show as alt text', () => {
    const el = dom('![a diagram](https://example.org/a.png)')
    expect(el.querySelector('img')).toBeNull()
    expect(el).toHaveTextContent('a diagram')
  })

  test('test past MAX_RENDER_CHARS the text shows plain', () => {
    const source = '**bold** start\n\n' + 'x'.repeat(MAX_RENDER_CHARS + 1 - 16)
    expect(source.length).toBe(MAX_RENDER_CHARS + 1)
    const el = dom(source)
    expect(el.querySelector('strong')).toBeNull()
    expect(el.textContent).toContain('**bold**')
    expect(el.querySelectorAll('p')).toHaveLength(2)
    expect(() => assertInert(renderChatMarkdown('<script>x</script>\n\n' + 'y'.repeat(MAX_RENDER_CHARS)))).not.toThrow()
  })

  test('test fenceLanguages', () => {
    expect(fenceLanguages('```python\n```\n```ts\n```')).toEqual(['python', 'ts'])
    expect(fenceLanguages('no code')).toEqual([])
    expect(fenceLanguages('- item\n\n  ```yaml\n  a: 1\n  ```')).toEqual(['yaml'])
  })
})
