import { describe, expect, test } from 'vitest'
import {
  classifyEmbedLine,
  formatAnnotation,
  formatItemComment,
  isKnownValue,
  makeOption,
  parseAnnotation,
  parseItemComment,
} from './annotations'
import { blockIdOf, blockIdsIn, blockRefMarkdown, joinBlocks, newBlockId, splitBlocks } from './blocks'
import { blockTargets, buildTree, flattenTree } from './blockTree'

describe('m8 annotations', () => {
  test('indent is a container like toggle and group', () => {
    expect(parseAnnotation('<!-- indent -->\n')).toEqual({ type: 'open', name: 'indent', options: [] })
    expect(parseAnnotation('<!-- /indent -->')).toEqual({ type: 'close', name: 'indent', options: [] })
    expect(parseAnnotation('<!-- INDENT -->')).toMatchObject({ type: 'open', name: 'indent' })
    expect(parseAnnotation('<!-- indented -->')).toBeNull()
    expect(formatAnnotation({ type: 'open', name: 'indent', options: [] })).toBe('<!-- indent -->')

    const body = 'Before\n\n<!-- indent -->\nParent\n\nChild\n<!-- /indent -->\n\nAfter\n'
    const tree = buildTree(splitBlocks(body))
    const container = tree.find((n) => n.kind === 'container')!
    expect(container).toMatchObject({ kind: 'container', name: 'indent' })
    expect(joinBlocks(flattenTree(tree))).toBe(body)

    // Unpaired lines stay plain.
    const stray = '<!-- /indent -->\n\nText\n\n<!-- indent -->\n'
    expect(buildTree(splitBlocks(stray)).every((n) => n.kind === 'leaf')).toBe(true)
  })

  test('block reference and dataview embed lines', () => {
    expect(classifyEmbedLine('![[Source note#^ab12cd]]')).toEqual({ kind: 'blockRef', target: 'Source note', id: 'ab12cd', label: null })
    expect(classifyEmbedLine('![[A#B#^zz9zz9|label]]\n')).toEqual({ kind: 'blockRef', target: 'A#B', id: 'zz9zz9', label: 'label' })
    expect(classifyEmbedLine('![[collection:reading-list]]')).toEqual({ kind: 'dataView', dataKind: 'collection', id: 'reading-list', label: null })
    expect(classifyEmbedLine('![[query:open-tasks]]')).toMatchObject({ kind: 'dataView', dataKind: 'query', id: 'open-tasks' })
    // Not quite: an ordinary object embed (round-trips as written).
    expect(classifyEmbedLine('![[Source note#^TOOLONG1]]')).toMatchObject({ kind: 'objectEmbed' })
    expect(classifyEmbedLine('![[collection:]]')).toMatchObject({ kind: 'objectEmbed', target: 'collection:' })
    expect(classifyEmbedLine('![[Source note#Heading]]')).toMatchObject({ kind: 'objectEmbed' })

    const block = (raw: string) => ({ kind: 'paragraph', raw })
    expect(blockTargets(block('![[Source note#^ab12cd]]'))).toEqual(['blockRef'])
    expect(blockTargets(block('![[query:q]]'))).toEqual(['dataView'])
    // "Show details" is a known flag for a data view only.
    expect(isKnownValue({ key: 'details', value: true })).toBe(true)
    const tree = buildTree(splitBlocks('<!-- block: details -->\n![[query:q]]\n'))
    expect(tree[0]).toMatchObject({ kind: 'leaf', annotation: { parsed: { options: [{ key: 'details' }] } } })
    const notApplied = buildTree(splitBlocks('<!-- block: details -->\nText\n'))
    expect(notApplied.every((n) => n.kind === 'leaf' && !n.annotation)).toBe(true)
  })

  test('item comments parse and format with the option grammar', () => {
    expect(parseItemComment('<!-- item: color=text-red -->')).toEqual({
      options: [{ key: 'color', value: 'text-red', raw: 'color=text-red' }],
      raw: '<!-- item: color=text-red -->',
    })
    expect(parseItemComment('<!--item:small   align=center--> ^ab12cd')?.raw).toBe('<!--item:small   align=center-->')
    expect(parseItemComment('<!-- item: x-future=1 small -->')?.options.map((o) => o.key)).toEqual(['x-future', 'small'])
    expect(parseItemComment('<!-- block: small -->')).toBeNull()
    expect(parseItemComment('<!-- item: color="unterminated -->')).toBeNull()
    expect(formatItemComment([makeOption('color', 'text-red'), makeOption('small', true)])).toBe('<!-- item: small color=text-red -->')
    expect(formatItemComment([])).toBe('')
  })

  test('block ids', () => {
    expect(blockIdOf('A paragraph. ^ab12cd')).toBe('ab12cd')
    expect(blockIdOf('Line one\nLine two ^zz9zz9\r\n')).toBe('zz9zz9')
    expect(blockIdOf('Too long ^TOOLONG1')).toBeNull()
    expect(blockIdOf('Upper ^AB12CD')).toBeNull()
    expect(blockIdOf('No space^ab12cd')).toBeNull()
    expect(blockIdsIn('a ^ab12cd\n- b ^zz9zz9\r\nc ^ab12cd\nd ^toolong1\n')).toEqual(['ab12cd', 'zz9zz9'])
    let calls = 0
    const stuck = () => (calls++ < 6 ? 0 : 0.5)
    // The first draw is taken, so a different id comes out.
    expect(newBlockId(['aaaaaa'], stuck)).not.toBe('aaaaaa')
    expect(newBlockId([], () => 0.999)).toMatch(/^[a-z0-9]{6}$/)
    expect(blockRefMarkdown('Source note', 'ab12cd')).toBe('![[Source note#^ab12cd]]')
    expect(blockRefMarkdown('Source note', 'ab12cd', 'quote')).toBe('![[Source note#^ab12cd|quote]]')
  })
})
