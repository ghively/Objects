import { describe, expect, test } from 'vitest'
import type { WhiteboardData } from '@/api/whiteboardTypes'
import { deepEqual, mergeBoards } from './merge'
import { board, edge, node, textBlock } from './test/boards'

const base = () =>
  board(
    [
      node({ id: 'a', blockId: 'ba', position: { x: 0, y: 0 } }),
      node({ id: 'b', position: { x: 90, y: 0 } }),
      node({ id: 'c', position: { x: 180, y: 0 } }),
    ],
    [edge({ id: 'ab', source: 'a', target: 'b' }), edge({ id: 'bc', source: 'b', target: 'c' })],
    { ba: textBlock('A') },
    { viewport: { x: 0, y: 0, zoom: 1 }, 'x-top': 1 },
  )

describe('mergeBoards', () => {
  test('mergeBoards applies local adds, edits and deletes onto remote; drops dangling edges', () => {
    const b = base()
    const local = structuredClone(b)
    local.nodes.d = node({ id: 'd', position: { x: 300, y: 0 } }) // add
    local.nodes.a = { ...local.nodes.a, position: { x: 30, y: 30 } } // edit
    delete local.nodes.c // delete
    delete local.edges.bc
    local.blocks.ba = textBlock('A edited')
    local.locked = true

    const remote = structuredClone(b)
    remote.nodes.e = node({ id: 'e', position: { x: 0, y: 300 } }) // remote add
    remote.nodes.b = { ...remote.nodes.b, width: 200 } // remote edit
    remote.edges.ce = edge({ id: 'ce', source: 'c', target: 'e' }) // touches c, which local removed
    remote.viewport = { x: 5, y: 5, zoom: 2 }
    remote['x-top'] = 2

    const out = mergeBoards(b, local, remote)
    expect(Object.keys(out.nodes).sort()).toEqual(['a', 'b', 'd', 'e'])
    expect(out.nodes.a.position).toEqual({ x: 30, y: 30 })
    expect(out.nodes.b.width).toBe(200)
    expect(out.edges.ab).toBeDefined()
    expect(out.edges.bc).toBeUndefined()
    expect(out.edges.ce).toBeUndefined() // dangling after the merge
    expect(out.blocks.ba).toEqual(textBlock('A edited'))
    expect(out.locked).toBe(true) // changed locally
    expect(out.viewport).toEqual({ x: 5, y: 5, zoom: 2 }) // unchanged locally: remote's
    expect(out['x-top']).toBe(2)
  })

  test('a local top-level removal removes it; unchanged keys follow remote', () => {
    const b: WhiteboardData = { ...base(), locked: true }
    const local = structuredClone(b)
    delete local.locked
    const remote = structuredClone(b)
    remote.readingOrder = ['a']
    const out = mergeBoards(b, local, remote)
    expect('locked' in out).toBe(false)
    expect(out.readingOrder).toEqual(['a'])
  })

  test('null base merges onto an empty board; a block removed remotely but used locally is kept', () => {
    const local = board([node({ id: 'x', blockId: 'bx' })], [], { bx: textBlock('mine') })
    const remote = board([node({ id: 'y' })])
    const out = mergeBoards(null, local, remote)
    expect(Object.keys(out.nodes).sort()).toEqual(['x', 'y'])
    expect(out.blocks.bx).toEqual(textBlock('mine'))

    const b = base()
    const l2 = structuredClone(b)
    l2.nodes.a = { ...l2.nodes.a, position: { x: 60, y: 0 } }
    const r2 = structuredClone(b)
    r2.blocks = {}
    const out2 = mergeBoards(b, l2, r2)
    expect(out2.nodes.a.blockId).toBe('ba')
    expect(out2.blocks.ba).toEqual(textBlock('A'))
  })

  test('no local change gives the remote board', () => {
    const b = base()
    const remote = structuredClone(b)
    remote.nodes.b = { ...remote.nodes.b, z: 7 }
    expect(mergeBoards(b, structuredClone(b), remote)).toEqual(remote)
  })

  test('deepEqual ignores undefined keys and compares arrays in order', () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true)
    expect(deepEqual([1, 2], [2, 1])).toBe(false)
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
  })
})
