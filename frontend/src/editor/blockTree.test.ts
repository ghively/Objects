import { describe, expect, test } from 'vitest'
import { joinBlocks, splitBlocks } from './blocks'
import { MAX_DEPTH, buildTree, flattenTree, type ContainerNode, type TreeNode } from './blockTree'
import { makeBigBody } from './__fixtures__/bigBody'

const fixtures = import.meta.glob('./__fixtures__/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const tree = (body: string) => buildTree(splitBlocks(body))
const roundTrip = (body: string) => joinBlocks(flattenTree(tree(body)))
/** Non-space nodes only, for readable assertions. */
const solid = (nodes: TreeNode[]) => nodes.filter((n) => n.kind !== 'leaf' || n.block.kind !== 'space')
const containers = (nodes: TreeNode[]) => nodes.filter((n): n is ContainerNode => n.kind === 'container')

describe('buildTree', () => {
  test('annotated leaf takes the block below it', () => {
    const nodes = solid(tree('<!-- block: color=bg-blue align=center -->\n## Rollout notes\n\nText.\n'))
    expect(nodes).toHaveLength(2)
    const [head, text] = nodes
    expect(head.kind).toBe('leaf')
    if (head.kind !== 'leaf') return
    expect(head.block).toEqual({ kind: 'heading', raw: '## Rollout notes' })
    expect(head.annotation?.raw).toBe('<!-- block: color=bg-blue align=center -->\n')
    expect(head.annotation?.parsed.options.map((o) => o.key)).toEqual(['color', 'align'])
    expect(text.kind === 'leaf' && text.annotation).toBeFalsy()
  })

  test('detached annotation stays a comment', () => {
    // Followed by a blank line.
    const blank = tree('<!-- block: small -->\n\nText.\n')
    expect(blank.map((n) => n.kind === 'leaf' && [n.block.kind, Boolean(n.annotation)])).toEqual([
      ['html', false],
      ['space', false],
      ['paragraph', false],
    ])
    // Followed by a block it doesn't apply to.
    for (const body of [
      '<!-- block: wrap -->\nNot code.\n',
      '<!-- block: small -->\n## A heading is never small\n',
      '<!-- block: list=roman -->\n- a bullet list\n',
      '<!-- block: quote=standout -->\nplain\n',
      '<!-- block: view=wideCard -->\n![x](y.png)\n',
      '<!-- block: small color=bg-red -->\n```\ncode\n```\n',
      '<!-- block: color=bg-red -->\n---\n',
      '<!-- block: color=bg-red -->\n<!-- group -->\nx\n<!-- /group -->\n',
      '<!-- block: color=bg-red -->\n<!-- TODO -->\n',
    ]) {
      const first = tree(body)[0]
      expect(first.kind === 'leaf' && first.block.kind, body).toBe('html')
      expect(first.kind === 'leaf' && first.annotation, body).toBeFalsy()
      expect(roundTrip(body)).toBe(body)
    }
    // At the end of the body there is nothing to attach to.
    expect(tree('<!-- block: small -->')).toEqual([{ kind: 'leaf', block: { kind: 'html', raw: '<!-- block: small -->' } }])
  })

  test('annotations apply per block kind', () => {
    const attached = (body: string) => {
      const n = tree(body)[0]
      return n.kind === 'leaf' && Boolean(n.annotation)
    }
    expect(attached('<!-- block: list=roman -->\n1. one\n2. two\n')).toBe(true)
    expect(attached('<!-- block: wrap lock preview=split -->\n```mermaid\ngraph TD\n```\n')).toBe(true)
    expect(attached('<!-- block: header-column no-header-row -->\n| a | b |\n| - | - |\n| c | d |\n')).toBe(true)
    expect(attached('<!-- block: color=bg-red align=center -->\n$$\nx\n$$\n')).toBe(true)
    expect(attached('<!-- block: width=120 caption="x" align=center -->\n![p](p.png)\n')).toBe(true)
    expect(attached('<!-- block: caption="x" -->\n![[clip.wav]]\n')).toBe(true)
    expect(attached('<!-- block: width=120 -->\n![[clip.wav]]\n')).toBe(false) // audio has no size
    expect(attached('<!-- block: view=embed width=400 height=300 -->\n![[Ada Lovelace]]\n')).toBe(true)
    expect(attached('<!-- block: bookmark -->\n[Docs](https://example.com)\n')).toBe(true)
    expect(attached('<!-- block: bookmark -->\nSee [Docs](https://example.com) here\n')).toBe(false)
    expect(attached('<!-- block: icon="⭐" small -->\nStarred\n')).toBe(true)
    expect(attached('<!-- block: quote=standout color=text-red -->\n> q\n')).toBe(true)
    // Unknown keys are neutral; an unknown value of a known key still attaches (and is kept).
    expect(attached('<!-- block: foo=bar -->\nText\n')).toBe(true)
    expect(attached('<!-- block: color=bg-purplish -->\nText\n')).toBe(true)
  })

  test('containers pair, nest and respect the depth limit', () => {
    const body = [
      '<!-- columns widths=40,60 -->',
      'Left.',
      '<!-- column -->',
      '<!-- group color=bg-gray -->',
      '<!-- toggle open -->',
      '### Title',
      'Child.',
      '<!-- /toggle -->',
      '<!-- /group -->',
      '<!-- /columns -->',
      '',
    ].join('\n')
    const [cols] = tree(body)
    expect(cols.kind).toBe('container')
    if (cols.kind !== 'container') return
    expect(cols.name).toBe('columns')
    expect(cols.open.raw).toBe('<!-- columns widths=40,60 -->\n')
    expect(cols.separators).toEqual([null, '<!-- column -->\n'])
    expect(cols.close.raw).toBe('<!-- /columns -->\n')
    expect(cols.columns).toHaveLength(2)
    const [group] = containers(cols.columns[1])
    expect(group.name).toBe('group')
    expect(group.separators).toEqual([null])
    const [toggle] = containers(group.columns[0])
    expect(toggle.name).toBe('toggle')
    expect(toggle.open.parsed.options).toEqual([{ key: 'open', value: true, raw: 'open' }])
    expect(toggle.columns[0].map((n) => n.kind === 'leaf' && n.block.kind)).toEqual(['heading', 'paragraph'])
    expect(roundTrip(body)).toBe(body)

    // Leaf annotations work inside containers; empty containers are allowed.
    const inner = tree('<!-- group -->\n<!-- block: small -->\nSmall.\n<!-- /group -->\n<!-- toggle -->\n<!-- /toggle -->\n')
    const [g, t] = containers(inner)
    const leaf = g.columns[0][0]
    expect(leaf.kind === 'leaf' && leaf.annotation?.parsed.options[0].key).toBe('small')
    expect(t.columns).toEqual([[]])

    // Nesting deeper than the limit leaves the too-deep container as plain lines.
    const nest = (n: number) =>
      Array.from({ length: n }, () => '<!-- group -->\n').join('') + 'Deep.\n' + Array.from({ length: n }, () => '<!-- /group -->\n').join('')
    const depthOf = (nodes: TreeNode[]): number => {
      const c = containers(nodes)[0]
      return c ? 1 + depthOf(c.columns[0]) : 0
    }
    expect(depthOf(tree(nest(MAX_DEPTH)))).toBe(MAX_DEPTH)
    const deep = tree(nest(MAX_DEPTH + 1))
    expect(depthOf(deep)).toBe(MAX_DEPTH)
    let innermost = deep
    for (let i = 0; i < MAX_DEPTH; i++) innermost = containers(innermost)[0].columns[0]
    expect(innermost.map((n) => n.kind === 'leaf' && n.block.raw)).toEqual(['<!-- group -->\n', 'Deep.\n', '<!-- /group -->\n'])
    expect(roundTrip(nest(MAX_DEPTH + 1))).toBe(nest(MAX_DEPTH + 1))
  })

  test('malformed containers fall back to plain blocks', () => {
    const plain = (body: string) => {
      expect(containers(tree(body)), body).toEqual([])
      expect(roundTrip(body)).toBe(body)
    }
    plain('<!-- toggle -->\nNever closed.\n') // open without close
    plain('Text.\n<!-- /group -->\n') // stray close
    plain('<!-- callout -->\nInside.\n<!-- /callout -->\n') // unknown name
    plain('<!-- toggle -->\nA\n<!-- /group -->\n') // mismatched close
    plain('<!-- column -->\nA separator outside columns.\n')
    plain('<!-- columns -->\n' + 'x\n<!-- column -->\n'.repeat(6) + 'y\n<!-- /columns -->\n') // seven columns

    // An unclosed open inside a container is plain; the container still pairs.
    const [group] = containers(tree('<!-- group -->\n<!-- toggle -->\nA\n<!-- /group -->\n'))
    expect(group.name).toBe('group')
    expect(group.columns[0].map((n) => n.kind === 'leaf' && n.block.raw)).toEqual(['<!-- toggle -->\n', 'A\n'])

    // A separator inside a toggle inside columns belongs to the toggle's lines, not the columns.
    const [cols] = containers(tree('<!-- columns -->\n<!-- toggle -->\nT\n<!-- column -->\n<!-- /toggle -->\n<!-- /columns -->\n'))
    expect(cols.columns).toHaveLength(1)

    // An open line followed by a blank line still opens; the blank line is a child.
    const [spaced] = containers(tree('<!-- toggle open -->\n\nTitle\n\n<!-- /toggle -->\n'))
    expect(spaced.open.raw).toBe('<!-- toggle open -->')
    expect(spaced.columns[0].map((n) => n.kind === 'leaf' && n.block.kind)).toEqual(['space', 'paragraph', 'space'])
  })

  test('every fixture body groups and joins back byte for byte', () => {
    const names = Object.keys(fixtures)
    for (const name of [
      'blocks-every.md',
      'blocks-handwritten.md',
      'blocks-crlf.md',
      'blocks-no-eol.md',
      'DailyNotes-2026-10-23.md',
      'People-Ada-Lovelace.md',
      'Servers-Alpha.md',
      'mixed.md',
      'mixed-crlf.md',
    ]) {
      expect(names).toContain(`./__fixtures__/${name}`)
    }
    expect(names.filter((n) => /\/(Pages|Tasks)-/.test(n)).length).toBeGreaterThanOrEqual(7)
    for (const [name, body] of Object.entries(fixtures)) {
      expect(roundTrip(body), name).toBe(body)
      const lf = body.replace(/\r\n/g, '\n')
      expect(roundTrip(lf), `${name} (LF)`).toBe(lf)
    }
    const big = makeBigBody()
    expect(roundTrip(big)).toBe(big)
  })

  test('fixtures carry the expected containers and annotations', () => {
    const count = (nodes: TreeNode[]): { containers: number; annotated: number } => {
      let c = 0
      let a = 0
      for (const n of nodes) {
        if (n.kind === 'leaf') a += n.annotation ? 1 : 0
        else {
          c++
          for (const col of n.columns) {
            const inner = count(col)
            c += inner.containers
            a += inner.annotated
          }
        }
      }
      return { containers: c, annotated: a }
    }
    expect(count(tree(fixtures['./__fixtures__/blocks-every.md']))).toEqual({ containers: 5, annotated: 14 })
    expect(count(tree(fixtures['./__fixtures__/blocks-handwritten.md']))).toEqual({ containers: 4, annotated: 3 })
    const crlf = fixtures['./__fixtures__/blocks-crlf.md']
    expect(crlf.startsWith('﻿')).toBe(true)
    expect(crlf).toContain('\r\n')
    expect(crlf.replace(/\r\n/g, '')).not.toContain('\n')
    expect(count(tree(crlf))).toEqual({ containers: 2, annotated: 1 })
    const noEol = fixtures['./__fixtures__/blocks-no-eol.md']
    expect(noEol.endsWith('<!-- /toggle -->')).toBe(true)
    const nodes = tree(noEol)
    const last = nodes[nodes.length - 1]
    expect(last.kind === 'container' && last.close.raw).toBe('<!-- /toggle -->')
  })
})
