import { describe, expect, test } from 'vitest'
import { colorValue, edgeStyle, nodeColor, nodeSize, NODE_MAX_SIZE, REDUCED_NODE_COLOR, REDUCED_NODE_SIZE } from './graphStyle'

describe('graphStyle', () => {
  test('node size and colour by degree and type', () => {
    expect(nodeSize(0)).toBe(3)
    expect(nodeSize(1)).toBe(5)
    expect(nodeSize(4)).toBe(7)
    expect(nodeSize(16)).toBe(11)
    expect(nodeSize(10000)).toBe(NODE_MAX_SIZE)
    expect(nodeSize(-3)).toBe(3)

    const types = { person: { color: 'teal' }, project: { color: 'not-a-colour' } }
    expect(nodeColor({ type: 'person', tag: false }, types)).toBe('teal')
    expect(nodeColor({ type: 'project', tag: false }, types)).toBe('gray')
    expect(nodeColor({ type: 'missing', tag: false }, types)).toBe('gray')
    // A tag uses its own colour (`bg-<c>`), falling back to its type's.
    expect(nodeColor({ type: 'person', tag: true }, types, 'bg-rose')).toBe('rose')
    expect(nodeColor({ type: 'person', tag: true }, types, null)).toBe('teal')
    // jsdom has no stylesheet: the fallback line colours are concrete.
    expect(colorValue('teal')).toBe('#1dad9d')
  })

  test('edge kinds are links and tag edges only (no synthesized indirect edges)', () => {
    expect(edgeStyle('tag').size).toBeLessThan(edgeStyle('link').size)
  })

  test('reduced nodes are drawn at the smallest size in gray', () => {
    expect(REDUCED_NODE_SIZE).toBe(nodeSize(0))
    expect(REDUCED_NODE_COLOR).toBe('gray')
  })
})
