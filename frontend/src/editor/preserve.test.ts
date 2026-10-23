import { describe, expect, test } from 'vitest'
import { joinBlocks, splitBlocks, type SourceBlock } from './blocks'
import { preserveBlock, serializeWithPreservation } from './preserve'
import { makeBigBody } from './__fixtures__/bigBody'

const fixtures = import.meta.glob('./__fixtures__/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function fixture(name: string): string {
  const text = fixtures[`./__fixtures__/${name}`]
  if (text === undefined) throw new Error(`missing fixture ${name}`)
  return text
}

/** Number of line positions whose text differs (line counts must match). */
function lineDiffCount(a: string, b: string): number {
  const la = a.split('\n')
  const lb = b.split('\n')
  expect(lb.length).toBe(la.length)
  return la.filter((line, i) => line !== lb[i]).length
}

/** Every block passed through unedited, as the editor does on load + save. */
function asEditorBlocks(bs: SourceBlock[]) {
  return bs.map((b) => ({ raw: b.raw, markdown: b.raw, kind: b.kind }))
}

describe('splitBlocks / joinBlocks', () => {
  test('fixtures are present', () => {
    expect(Object.keys(fixtures).length).toBeGreaterThanOrEqual(13)
    expect(fixture('mixed-crlf.md')).toContain('\r\n')
    expect(fixture('Tasks-Fix-printer.md')).toContain('\r\n')
  })

  test('split/join identity on every fixture', () => {
    for (const [name, body] of Object.entries(fixtures)) {
      const blocks = splitBlocks(body)
      expect(joinBlocks(blocks), name).toBe(body)
      // CRLF-normalised text keeps the identity too.
      const lf = body.replace(/\r\n/g, '\n')
      expect(joinBlocks(splitBlocks(lf)), `${name} (LF)`).toBe(lf)
    }
  })

  test('split/join identity on CRLF, lone CR, and edge cases', () => {
    const cases = [
      '',
      '\n',
      'no newline',
      'a\r\nb\r\n\r\n* x\r\n',
      'a\rb\r\rc',
      '\r\n\r\n# H\r\n  \r\ntext\t\r\n',
      '﻿bom first\n',
    ]
    for (const body of cases) expect(joinBlocks(splitBlocks(body))).toBe(body)
  })

  test('blocks keep their kinds: HTML, Field::, Mermaid, nested lists', () => {
    const blocks = splitBlocks(fixture('mixed.md'))
    const kinds = blocks.filter((b) => b.kind !== 'space').map((b) => b.kind)
    expect(kinds).toContain('html')
    expect(kinds).toContain('table')
    expect(kinds).toContain('blockquote')
    const field = blocks.find((b) => b.raw.startsWith('Status::'))
    expect(field?.raw).toBe('Status:: Active\nOwner:: [[Ada Lovelace]]')
    const mermaid = blocks.find((b) => b.kind === 'code')
    expect(mermaid?.raw).toBe('```mermaid\ngraph TD\n  A --> B\n```')
    const nested = blocks.find((b) => b.kind === 'list')
    expect(nested?.raw).toContain('        * Label both ends')
  })

  test('CRLF blocks keep CRLF in raw', () => {
    const blocks = splitBlocks(fixture('mixed-crlf.md'))
    const list = blocks.find((b) => b.kind === 'list')
    expect(list?.raw).toBe(
      '* Prepare\r\n    * Check power  \r\n    * Check cables\r\n        * Label both ends\r\n* Run',
    )
  })

  test('1MB body splits under 300ms', () => {
    const body = makeBigBody()
    expect(body.length).toBeGreaterThan(900_000)
    splitBlocks(body.slice(0, 20_000)) // warm up the lexer
    const t0 = performance.now()
    const blocks = splitBlocks(body)
    const elapsed = performance.now() - t0
    expect(blocks.filter((b) => b.kind === 'table')).toHaveLength(300)
    expect(joinBlocks(blocks)).toBe(body)
    expect(elapsed).toBeLessThan(300)
  })
})

describe('preserveBlock', () => {
  test('unchanged block keeps raw', () => {
    const raw = 'Trailing\tspaces   \n'
    expect(preserveBlock(raw, 'Trailing\tspaces', 'paragraph')).toBe(raw)
    const table = '|Host|Role|\n|:---|---:|\n|alpha|db|'
    expect(preserveBlock(table, '| Host | Role |\n| :--- | ---: |\n| alpha | db |\n', 'table')).toBe(
      table,
    )
    const list = '* a\n    * b'
    expect(preserveBlock(list, '- a\n  - b\n', 'list')).toBe(list)
  })

  test('unchanged body through serializeWithPreservation is byte-identical', () => {
    for (const [name, body] of Object.entries(fixtures)) {
      expect(serializeWithPreservation(asEditorBlocks(splitBlocks(body))), name).toBe(body)
    }
  })

  test('edited paragraph takes the new text and keeps CRLF', () => {
    const out = preserveBlock('Old text\r\nsecond', 'New text\nsecond', 'paragraph')
    expect(out).toBe('New text\r\nsecond')
  })

  test('one table cell edit changes one line', () => {
    const original = [
      '| Port  | Service |',
      '| ----- | ------- |',
      '| 22    | ssh     |',
      '| 443   | https   |',
    ].join('\n')
    const regenerated = '| Port | Service |\n| --- | --- |\n| 22 | ssh |\n| 443 | web |\n'
    const out = preserveBlock(original, regenerated, 'table')
    expect(lineDiffCount(original, out)).toBe(1)
    expect(out.split('\n')[3]).toBe('| 443   | web     |')
  })

  test('one table cell edit in a whole body changes one line (CRLF kept)', () => {
    const body = fixture('Servers-Alpha.md').replace(/\n/g, '\r\n')
    const blocks = asEditorBlocks(splitBlocks(body))
    const first = blocks.find((b) => b.kind === 'table')!
    first.markdown = '| Port | Service |\n| --- | --- |\n| 22 | sshd |\n| 443 | https |'
    const out = serializeWithPreservation(blocks)
    expect(lineDiffCount(body, out)).toBe(1)
    expect(out).toContain('| 22 | sshd |\r\n')
    expect(out.split('\n').slice(0, -1).every((l) => l.endsWith('\r'))).toBe(true)
  })

  test('1MB body: editing one cell rewrites exactly one line', () => {
    const body = makeBigBody()
    const blocks = asEditorBlocks(splitBlocks(body))
    const tables = blocks.filter((b) => b.kind === 'table')
    const target = tables[150]
    target.markdown = target.raw.replace('| role-3 |', '| role-X |')
    expect(target.markdown).not.toBe(target.raw)
    const t0 = performance.now()
    const out = serializeWithPreservation(blocks)
    expect(performance.now() - t0).toBeLessThan(500)
    expect(lineDiffCount(body, out)).toBe(1)
  })

  test('table cell padding style follows the original', () => {
    const original = '|Host|Role|\n|:---|---:|\n|alpha|db|'
    const out = preserveBlock(original, '| Host | Role |\n| :--- | ---: |\n| beta | db |', 'table')
    expect(out).toBe('|Host|Role|\n|:---|---:|\n|beta|db|')
  })

  test("one list item edit keeps '*' bullets and 4-space indent", () => {
    const original = '* Prepare\n    * Check power\n    * Check cables\n* Run'
    const regenerated = '- Prepare\n  - Check power\n  - Check wiring\n- Run\n'
    const out = preserveBlock(original, regenerated, 'list')
    expect(out).toBe('* Prepare\n    * Check power\n    * Check wiring\n* Run')
    expect(lineDiffCount(original, out)).toBe(1)
  })

  test('list item added at a deeper level uses the original indent unit', () => {
    const original = '* a\n    * b\n* c'
    const out = preserveBlock(original, '- a\n  - b\n    - b1\n- c', 'list')
    expect(out).toBe('* a\n    * b\n        * b1\n* c')
  })

  test('column added rewrites table', () => {
    const original = '| Port | Service |\n| --- | --- |\n| 22 | ssh |'
    const regenerated = '| Port | Service | Proto |\n| --- | --- | --- |\n| 22 | ssh | tcp |'
    const out = preserveBlock(original, regenerated, 'table')
    expect(out).toBe(regenerated)
  })

  test('new blocks without raw are separated by a blank line', () => {
    const out = serializeWithPreservation([
      { raw: '# Title\n', markdown: '# Title', kind: 'heading' },
      { raw: 'Para one', markdown: 'Para one', kind: 'paragraph' },
      { markdown: 'Brand new', kind: 'paragraph' },
      { raw: '\n\n', markdown: '', kind: 'space' },
      { raw: 'Last\n', markdown: 'Last', kind: 'paragraph' },
    ])
    expect(out).toBe('# Title\nPara one\n\nBrand new\n\nLast\n')
  })

  test('deleting the block between two paragraphs does not merge them', () => {
    const blocks = asEditorBlocks(splitBlocks('one\n\ntwo\n\nthree\n'))
    // An editor that keeps only content blocks (no space tokens).
    const kept = blocks.filter((b) => b.kind !== 'space' && b.raw !== 'two')
    expect(serializeWithPreservation(kept)).toBe('one\n\nthree\n')
    const crlf = asEditorBlocks(splitBlocks('one\r\n\r\ntwo\r\n'))
    const keptCrlf = crlf.filter((b) => b.kind !== 'space')
    keptCrlf.splice(1, 0, { raw: undefined as unknown as string, markdown: 'mid', kind: 'paragraph' })
    expect(serializeWithPreservation(keptCrlf)).toBe('one\r\n\r\nmid\r\n\r\ntwo\r\n')
  })

  test('one-line blocks in a CRLF body edited to two lines keep CRLF on every line', () => {
    const blocks = asEditorBlocks(splitBlocks('x\r\n\r\n* a\r\n\r\nend\r\n'))
    const list = blocks.find((b) => b.kind === 'list')!
    list.markdown = '- a\n- b'
    const para = blocks.find((b) => b.kind === 'paragraph' && b.raw.startsWith('end'))!
    para.markdown = 'end\nmore'
    const out = serializeWithPreservation(blocks)
    expect(out).toBe('x\r\n\r\n* a\r\n* b\r\n\r\nend\r\nmore\r\n')
    expect(out.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
  })

  test('preserveBlock uses a caller-supplied ending for a one-line original', () => {
    expect(preserveBlock('hello', 'hello\nworld', 'paragraph')).toBe('hello\nworld')
    expect(preserveBlock('hello', 'hello\nworld', 'paragraph', '\r\n')).toBe('hello\r\nworld')
    // An original with its own line break keeps its own ending.
    expect(preserveBlock('a\nb', 'a\nc\nd', 'paragraph', '\r\n')).toBe('a\nc\nd')
  })
})
