import { describe, expect, test } from 'vitest'
import { joinBlocks, splitBlocks } from './blocks'
import { makeBigBody } from './__fixtures__/bigBody'

const kinds = (body: string) => splitBlocks(body).map((b) => [b.kind, b.raw])

describe('splitBlocks math blocks (rule 6)', () => {
  test('math block spans blank lines', () => {
    const body = '$$\nE = mc^2\n\na^2 + b^2 = c^2\n$$\n\nAfter.\n'
    expect(kinds(body)).toEqual([
      ['math', '$$\nE = mc^2\n\na^2 + b^2 = c^2\n$$'],
      ['space', '\n\n'],
      ['paragraph', 'After.\n'],
    ])
    const crlf = body.replace(/\n/g, '\r\n')
    const blocks = splitBlocks(crlf)
    expect(blocks[0]).toEqual({ kind: 'math', raw: '$$\r\nE = mc^2\r\n\r\na^2 + b^2 = c^2\r\n$$' })
    expect(joinBlocks(blocks)).toBe(crlf)
    // A math block interrupts a paragraph, and the next block follows directly.
    expect(kinds('Text\n$$\nx\n$$\nMore\n')).toEqual([
      ['paragraph', 'Text\n'],
      ['math', '$$\nx\n$$\n'],
      ['paragraph', 'More\n'],
    ])
    // Indented up to three spaces, and the closing line may carry text before `$$`.
    expect(kinds('   $$ \\begin{x}\n  y \\end{x} $$  \n')).toEqual([['math', '   $$ \\begin{x}\n  y \\end{x} $$  \n']])
    // Four spaces is indented code, not math.
    expect(splitBlocks('    $$\n    x\n    $$\n')[0].kind).toBe('code')
  })

  test('one-line math block', () => {
    expect(kinds('$$x$$')).toEqual([['math', '$$x$$']])
    expect(kinds('$$E = mc^2$$\n\nText.\n')).toEqual([
      ['math', '$$E = mc^2$$'],
      ['space', '\n\n'],
      ['paragraph', 'Text.\n'],
    ])
  })

  test('dollars that are not a math block stay what they were', () => {
    // No closing line: an ordinary paragraph.
    expect(kinds('$$ costs a lot\nand more\n')).toEqual([['paragraph', '$$ costs a lot\nand more\n']])
    // Inline math and prices are paragraph text.
    expect(kinds('Price $5 and $a$.\n')).toEqual([['paragraph', 'Price $5 and $a$.\n']])
    // Inside a fence, a list or a quote, `$$` belongs to that block.
    expect(kinds('```\n$$\nx\n$$\n```\n')).toEqual([['code', '```\n$$\nx\n$$\n```\n']])
    expect(kinds('> $$\n> x\n> $$\n')).toEqual([['blockquote', '> $$\n> x\n> $$\n']])
    expect(kinds('- a\n\n  $$\n  b\n  $$\n')).toEqual([['list', '- a\n\n  $$\n  b\n  $$\n']])
  })

  test('join invariant holds with math and the big body stays fast', () => {
    for (const body of [
      '$$',
      '$$\n',
      '$$\n$$',
      '$$$$\n',
      'a\n$$\n\n\n$$\nb',
      '$$\r\nx\r\n$$',
      '$$\rx\r$$\r',
      '\ufeff$$x$$\n',
      '$$a$$\n$$b$$\n$$\nc\n$$',
    ]) {
      expect(joinBlocks(splitBlocks(body)), JSON.stringify(body)).toBe(body)
    }
    const big = makeBigBody() + '\n\n$$\nx\n$$\n' + 'Para with $5.\n\n'.repeat(2000)
    const t0 = performance.now()
    const blocks = splitBlocks(big)
    const ms = performance.now() - t0
    expect(joinBlocks(blocks)).toBe(big)
    expect(blocks.filter((b) => b.kind === 'math')).toHaveLength(1)
    expect(ms).toBeLessThan(2000) // generous: the start hook must not rescan the body per paragraph
  })
})
