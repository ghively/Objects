import { describe, expect, test } from 'vitest'
import type { WhiteboardData, WhiteboardNode } from '@/api/whiteboardTypes'
import * as A from './actions'
import { CIRCUIT_LABELS, CIRCUIT_TEXT, GRID, SHAPES, isCircuitNode, type Box } from './model'
import { board, edge, node, textBlock } from './test/boards'

const onGrid = (v: number) => Math.abs(v % GRID) === 0
const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height })

describe('newId', () => {
  test('ids are 26 safe characters, unique and time ordered', () => {
    const ids = new Set(Array.from({ length: 500 }, () => A.newId()))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(id).toMatch(/^[0-9A-Z]{26}$/)
    expect(A.newId(1000) < A.newId(2000)).toBe(true)
  })
})

describe('createFromTool', () => {
  test('create from each tool uses defaults and snapping', () => {
    const empty = board()
    // Text: 420 × 60 centred on the click, snapped; an empty text block
    const text = A.createFromTool(empty, 'text', { x: 100, y: 100 }, { id: 't' })
    const t = text.nodes.t
    expect(t).toMatchObject({ kind: 'block', width: 420, height: 60, z: 1 })
    expect(onGrid(t.position.x) && onGrid(t.position.y)).toBe(true)
    expect(text.blocks[t.blockId!]).toEqual({ type: 'text', markdown: '' })

    // Every shape: 90 × 90 on a click, z above content
    for (const shape of SHAPES) {
      const b = A.createFromTool(text, shape, { x: 47, y: 13 }, { id: 's' })
      expect(b.nodes.s).toMatchObject({ kind: 'shape', shape, width: 90, height: 90, z: 2 })
      expect(onGrid(b.nodes.s.position.x) && onGrid(b.nodes.s.position.y)).toBe(true)
      expect(b.nodes.s.blockId).toBeUndefined()
    }

    // A dragged box snaps both edges to the grid with the shape floor
    const dragged = A.createFromTool(empty, 'ellipse', box(14, 16, 200, 40), { id: 'e' })
    expect(dragged.nodes.e).toMatchObject({ position: { x: 0, y: 30 }, width: 210, height: 90 })
    // A reversed drag is normalised
    const reversed = A.createFromTool(empty, 'rectangle', box(300, 300, -150, -150), { id: 'r' })
    expect(reversed.nodes.r).toMatchObject({ position: { x: 150, y: 150 }, width: 150, height: 150 })
    // Snapping off (Ctrl held) keeps the drawn box, with the floor
    const free = A.createFromTool(empty, 'text', box(14, 16, 20, 10), { id: 'f', snap: false })
    expect(free.nodes.f).toMatchObject({ position: { x: 14, y: 16 }, width: 40, height: 30 })

    // Shape colours and the remembered size from the tool memory
    const coloured = A.createFromTool(empty, 'star', { x: 0, y: 0 }, {
      id: 'c',
      fillColor: 'bg-blue',
      borderColor: 'red',
      size: { width: 120, height: 150 },
    })
    expect(coloured.nodes.c).toMatchObject({ fillColor: 'bg-blue', borderColor: 'red', width: 120, height: 150 })

    // Frame: 480 × 420, behind content, "Frame 1"
    const frame = A.createFromTool(text, 'frame', { x: 0, y: 0 }, { id: 'fr' })
    expect(frame.nodes.fr).toMatchObject({ kind: 'frame', width: 480, height: 420, title: 'Frame 1' })
    expect(frame.nodes.fr.z!).toBeLessThan(1)

    // Pointer and picker tools make nothing
    for (const tool of ['select', 'hand', 'link', 'create'] as const) {
      expect(A.createFromTool(text, tool, { x: 0, y: 0 })).toBe(text)
    }
    expect(text.nodes).not.toBe(empty.nodes)
    expect(empty).toEqual(board())
  })

  test('next frame title skips used numbers and ignores custom titles', () => {
    const b = board([
      node({ id: 'f1', kind: 'frame', title: 'Frame 1' }),
      node({ id: 'f3', kind: 'frame', title: 'Frame 3' }),
      node({ id: 'fx', kind: 'frame', title: 'Roadmap' }),
    ])
    const out = A.createFromTool(b, 'frame', { x: 0, y: 0 }, { id: 'n' })
    expect(out.nodes.n.title).toBe('Frame 2')
    const again = A.createFromTool(out, 'frame', { x: 0, y: 0 }, { id: 'm' })
    expect(again.nodes.m.title).toBe('Frame 4')
  })

  test('line in empty space creates two points and an edge', () => {
    const b = A.createFromTool(board(), 'line', { start: { x: 2, y: 4 }, end: { x: 178, y: 92 } }, { id: 'l' })
    const points = Object.values(b.nodes)
    expect(points).toHaveLength(2)
    expect(points.every((p) => p.kind === 'point' && p.width === undefined)).toBe(true)
    const e = b.edges.l
    expect(b.nodes[e.source].position).toEqual({ x: 0, y: 0 })
    expect(b.nodes[e.target].position).toEqual({ x: 180, y: 90 })
    expect(e.markerEnd).toBeUndefined()
    expect(e.markerStart).toBeUndefined()
    // A click draws a short horizontal line; a zero-length drag still gets length
    const click = A.createFromTool(board(), 'line', { x: 60, y: 60 }, { id: 'c' })
    const [s, t] = [click.nodes[click.edges.c.source], click.nodes[click.edges.c.target]]
    expect(t.position.x - s.position.x).toBe(A.DEFAULT_CONNECTOR_LENGTH)
    expect(t.position.y).toBe(s.position.y)
    const zero = A.createFromTool(board(), 'line', { start: { x: 30, y: 30 }, end: { x: 31, y: 29 } }, { id: 'z' })
    expect(zero.nodes[zero.edges.z.target].position).toEqual({ x: 30 + A.DEFAULT_CONNECTOR_LENGTH, y: 30 })
  })

  test('arrow tool sets end arrow; new edges copy the remembered style', () => {
    const b = A.createFromTool(board(), 'arrow', { start: { x: 0, y: 0 }, end: { x: 90, y: 0 } }, {
      id: 'a',
      lastConnection: 'curved',
      lastLine: 'dashed',
    })
    expect(b.edges.a).toMatchObject({ markerEnd: 'arrow', connection: 'curved', line: 'dashed' })
    expect(b.edges.a.markerStart).toBeUndefined()
    // Unset remembered style leaves the keys out (unset = cornered, solid)
    const plain = A.createFromTool(board(), 'line', { x: 0, y: 0 }, { id: 'p' })
    expect('connection' in plain.edges.p).toBe(false)
    expect('line' in plain.edges.p).toBe(false)

    const two = board([node({ id: 'x' }), node({ id: 'y', kind: 'shape', shape: 'ellipse' }), node({ id: 'pt', kind: 'point' })])
    const c = A.connect(two, 'x', 'y', { sourceHandle: 'right', targetHandle: 'left' }, { connection: 'straight', line: 'dotted' }, 'e1')
    expect(c.edges.e1).toEqual({ id: 'e1', source: 'x', target: 'y', sourceHandle: 'right', targetHandle: 'left', connection: 'straight', line: 'dotted' })
    expect(A.connect(two, 'x', 'x')).toBe(two)
    expect(A.connect(two, 'x', 'missing')).toBe(two)
    expect(A.connect(two, 'x', 'pt')).toBe(two) // points never take connectors
  })

  test('gates persist as rectangle plus label', () => {
    for (const gate of CIRCUIT_LABELS) {
      const b = A.createFromTool(board(), gate, { x: 0, y: 0 }, { id: 'g' })
      const g = b.nodes.g
      expect(g).toMatchObject({ kind: 'shape', shape: 'rectangle', width: 90, height: 90 })
      expect(b.blocks[g.blockId!]).toEqual({ type: 'text', markdown: CIRCUIT_TEXT[gate] })
      expect(isCircuitNode(g, b.blocks)).toBe(true)
      expect(Object.values(g)).not.toContain(gate) // never as node.shape or any other key
    }
  })

  test('createEntity embeds a wikilink centred on the drop point', () => {
    const b = A.createEntity(board([node({ id: 'n', z: 4 })]), '[[Router A]]', { x: 400, y: 300 }, { id: 'o' })
    const o = b.nodes.o
    expect(o).toMatchObject({ kind: 'block', width: 360, height: A.DEFAULT_ENTITY_HEIGHT, z: 5 })
    expect(b.blocks[o.blockId!]).toEqual({ type: 'entity', link: '[[Router A]]' })
    expect(o.position.x + 180).toBeCloseTo(400, -2)
    expect(onGrid(o.position.x) && onGrid(o.position.y)).toBe(true)
  })
})

describe('editing', () => {
  test('updateNode and updateEdge patch, remove undefined keys and keep identity on no-op', () => {
    const b = board([node({ id: 'a', fillColor: 'bg-red', 'x-k': 1 } as Partial<WhiteboardNode>)], [edge({ id: 'e', source: 'a', target: 'a' })])
    const u = A.updateNode(b, 'a', { fillColor: undefined, rotation: 45, kind: 'frame', id: 'zzz' })
    expect(u.nodes.a).toEqual({ id: 'a', kind: 'block', position: { x: 0, y: 0 }, rotation: 45, 'x-k': 1 })
    expect(A.updateNode(b, 'a', { fillColor: 'bg-red' })).toBe(b)
    expect(A.updateNode(b, 'nope', { z: 1 })).toBe(b)
    expect(A.updateEdge(b, 'e', { color: 'blue' }).edges.e.color).toBe('blue')
    expect(A.updateEdge(b, 'e', { color: undefined })).toBe(b)
  })

  test('setBlock creates, replaces and removes; an edge label replaces the deprecated string', () => {
    const b = board([node({ id: 'a' }), node({ id: 'b' })], [edge({ id: 'e', source: 'a', target: 'b', label: 'old' })])
    const withText = A.setBlock(b, 'a', textBlock('hello'))
    const bid = withText.nodes.a.blockId!
    expect(withText.blocks[bid]).toEqual(textBlock('hello'))
    const replaced = A.setBlock(withText, 'a', textBlock('bye', 'center'))
    expect(replaced.nodes.a.blockId).toBe(bid)
    expect(replaced.blocks[bid]).toEqual(textBlock('bye', 'center'))
    const removed = A.setBlock(replaced, 'a', null)
    expect(removed.nodes.a.blockId).toBeUndefined()
    expect(removed.blocks[bid]).toBeUndefined()

    const labelled = A.addEdgeLabel(b, 'e')
    expect(labelled.edges.e.label).toBeUndefined()
    expect(labelled.blocks[labelled.edges.e.blockId!]).toEqual(textBlock('old'))
    expect(A.addEdgeLabel(labelled, 'e')).toBe(labelled)
    const unlabelled = A.removeEdgeLabel(labelled, 'e')
    expect(unlabelled.edges.e.blockId).toBeUndefined()
    expect(unlabelled.blocks).toEqual({})
  })

  test('frame titles add and remove; lock sets and clears', () => {
    const b = board([node({ id: 'f', kind: 'frame', title: 'Frame 1' }), node({ id: 'g', kind: 'frame' })])
    expect(A.addFrameTitle(b, 'g').nodes.g.title).toBe('Frame 2')
    expect(A.addFrameTitle(b, 'f')).toBe(b)
    expect('title' in A.removeFrameTitle(b, 'f').nodes.f).toBe(false)
    const locked = A.setLocked(b, true)
    expect(locked.locked).toBe(true)
    expect('locked' in A.setLocked(locked, false)).toBe(false)
    expect(A.setLocked(b, false)).toBe(b)
  })
})

describe('removeSelection', () => {
  test('remove selection removes touching edges and unused blocks; skips locked', () => {
    const b = board(
      [
        node({ id: 'a', blockId: 'ba' }),
        node({ id: 'b', blockId: 'bb' }),
        node({ id: 'c', locked: true, blockId: 'bc' }),
        node({ id: 'p1', kind: 'point' }),
        node({ id: 'p2', kind: 'point' }),
      ],
      [
        edge({ id: 'ab', source: 'a', target: 'b', blockId: 'bl' }),
        edge({ id: 'bc', source: 'b', target: 'c' }),
        edge({ id: 'line', source: 'p1', target: 'p2' }),
      ],
      { ba: textBlock('a'), bb: textBlock('b'), bc: textBlock('c'), bl: textBlock('label') },
      { readingOrder: ['a', 'b', 'c'], 'x-top': 1 },
    )
    const out = A.removeSelection(b, ['a', 'c', 'line'])
    expect(Object.keys(out.nodes).sort()).toEqual(['b', 'c'])
    expect(Object.keys(out.edges)).toEqual(['bc'])
    expect(Object.keys(out.blocks).sort()).toEqual(['bb', 'bc'])
    expect(out.readingOrder).toEqual(['b', 'c'])
    expect(out['x-top']).toBe(1)
    // A locked node alone: nothing changes
    expect(A.removeSelection(b, ['c'])).toBe(b)
    expect(A.removeSelection(b, [])).toBe(b)
  })
})

describe('z order', () => {
  test('frame z stays below content', () => {
    let b = board()
    b = A.createFromTool(b, 'rectangle', { x: 0, y: 0 }, { id: 's1' })
    b = A.createFromTool(b, 'frame', { x: 0, y: 0 }, { id: 'f1' })
    b = A.createFromTool(b, 'text', { x: 0, y: 0 }, { id: 't1' })
    b = A.createFromTool(b, 'frame', { x: 0, y: 0 }, { id: 'f2' })
    const content = () => ['s1', 't1'].map((id) => b.nodes[id].z!)
    const frames = () => ['f1', 'f2'].map((id) => b.nodes[id].z!)
    const check = () => {
      expect(Math.min(...content())).toBeGreaterThanOrEqual(1)
      expect(Math.max(...frames())).toBeLessThan(Math.min(...content()))
    }
    check()
    expect(b.nodes.f2.z!).toBeLessThan(b.nodes.f1.z!) // a new frame goes below every frame

    b = A.order(b, ['f2'], 'front')
    check()
    expect(b.nodes.f2.z!).toBeGreaterThan(b.nodes.f1.z!)
    b = A.order(b, ['s1'], 'back')
    check()
    b = A.order(b, ['s1', 'f1'], 'front')
    check()
    expect(b.nodes.s1.z!).toBeGreaterThan(b.nodes.t1.z!)
    expect(b.nodes.f1.z!).toBeGreaterThan(b.nodes.f2.z!)
    b = A.order(b, ['s1'], 'backward')
    check()
    expect(b.nodes.s1.z!).toBeLessThan(b.nodes.t1.z!)
    b = A.order(b, ['s1'], 'forward')
    expect(b.nodes.s1.z!).toBeGreaterThan(b.nodes.t1.z!)
    // already at the front: nothing changes
    expect(A.order(b, ['s1'], 'front')).toBe(b)
  })

  test('order renumbers clashing z values among content', () => {
    const b = board([node({ id: 'a', z: 1 }), node({ id: 'b', z: 1 }), node({ id: 'c', z: 1 })])
    const out = A.order(b, ['a'], 'front')
    const zs = ['a', 'b', 'c'].map((id) => out.nodes[id].z!)
    expect(new Set(zs).size).toBe(3)
    expect(out.nodes.a.z).toBe(Math.max(...zs))
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(1)
  })
})

describe('place, flip, nudge', () => {
  const three = () =>
    board([
      node({ id: 'a', position: { x: 0, y: 0 }, width: 60, height: 30 }),
      node({ id: 'b', position: { x: 120, y: 90 }, width: 90, height: 60 }),
      node({ id: 'c', position: { x: 300, y: 30 }, width: 30, height: 120 }),
    ])
  const pos = (b: WhiteboardData) => Object.fromEntries(Object.values(b.nodes).map((n) => [n.id, [n.position.x, n.position.y]]))
  const ids = ['a', 'b', 'c']

  test('place left center right top middle bottom row column grid', () => {
    // bounds: x 0..330, y 0..150
    expect(pos(A.place(three(), ids, 'left'))).toEqual({ a: [0, 0], b: [0, 90], c: [0, 30] })
    expect(pos(A.place(three(), ids, 'right'))).toEqual({ a: [270, 0], b: [240, 90], c: [300, 30] })
    expect(pos(A.place(three(), ids, 'center'))).toEqual({ a: [135, 0], b: [120, 90], c: [150, 30] })
    expect(pos(A.place(three(), ids, 'top'))).toEqual({ a: [0, 0], b: [120, 0], c: [300, 0] })
    expect(pos(A.place(three(), ids, 'bottom'))).toEqual({ a: [0, 120], b: [120, 90], c: [300, 30] })
    expect(pos(A.place(three(), ids, 'middle'))).toEqual({ a: [0, 60], b: [120, 45], c: [300, 15] })
    // row: left to right, one grid cell apart, from the top-left corner
    expect(pos(A.place(three(), ids, 'row'))).toEqual({ a: [0, 0], b: [90, 0], c: [210, 0] })
    // column: top to bottom (a y0, c y30, b y90)
    expect(pos(A.place(three(), ids, 'column'))).toEqual({ a: [0, 0], c: [0, 60], b: [0, 210] })
    // grid: 2 columns, cells as large as the largest (90 × 120) plus one cell
    expect(pos(A.place(three(), ids, 'grid'))).toEqual({ a: [0, 0], c: [120, 0], b: [0, 150] })
    // fewer than two: nothing
    const b = three()
    expect(A.place(b, ['a'], 'left')).toBe(b)
  })

  test('flip toggles flipX and flipY on shapes only', () => {
    const b = board([node({ id: 's', kind: 'shape', shape: 'triangle' }), node({ id: 't' })])
    const x = A.flip(b, ['s', 't'], 'x')
    expect(x.nodes.s.flipX).toBe(true)
    expect(x.nodes.t).toBe(b.nodes.t)
    expect('flipX' in A.flip(x, ['s'], 'x').nodes.s).toBe(false)
    expect(A.flip(b, ['s'], 'y').nodes.s.flipY).toBe(true)
  })

  test('nudge moves the selection and a frame takes its contents; locked stay', () => {
    const b = board([
      node({ id: 'f', kind: 'frame', position: { x: 0, y: 0 }, width: 480, height: 420 }),
      node({ id: 'in', position: { x: 30, y: 30 }, width: 90, height: 60 }),
      node({ id: 'out', position: { x: 450, y: 30 }, width: 90, height: 60 }),
      node({ id: 'lk', locked: true, position: { x: 60, y: 300 }, width: 30, height: 30 }),
    ])
    expect(A.frameContents(b, 'f').sort()).toEqual(['in', 'lk'])
    const out = A.nudge(b, ['f'], GRID, -GRID * 5)
    expect(pos(out)).toEqual({ f: [30, -150], in: [60, -120], out: [450, 30], lk: [60, 300] })
    expect(A.nudge(b, ['f'], 0, 0)).toBe(b)
  })
})

describe('frames, duplicate, clear', () => {
  test('wrap in frame pads one cell and titles Frame N', () => {
    const b = board([
      node({ id: 'f0', kind: 'frame', title: 'Frame 1', position: { x: 900, y: 900 }, width: 90, height: 90, z: 0 }),
      node({ id: 'a', position: { x: 65, y: 40 }, width: 100, height: 50, z: 1 }),
      node({ id: 'b', position: { x: 200, y: 120 }, width: 60, height: 60, z: 2 }),
    ])
    const out = A.wrapInFrame(b, ['a', 'b'], { id: 'w' })
    // bounds 65..260 × 40..180, padded by 30 and snapped outward
    expect(out.nodes.w).toMatchObject({ kind: 'frame', title: 'Frame 2', position: { x: 30, y: 0 }, width: 270, height: 210 })
    expect(out.nodes.w.z!).toBeLessThan(0)
    expect(A.frameContents(out, 'w').sort()).toEqual(['a', 'b'])
    expect(A.wrapInFrame(b, [])).toBe(b)
  })

  test('duplicate offsets one cell and copies blocks', () => {
    const b = board(
      [
        node({ id: 'a', blockId: 'ba', position: { x: 0, y: 0 }, z: 1, locked: true }),
        node({ id: 'b', kind: 'shape', shape: 'ellipse', position: { x: 90, y: 0 }, z: 2 }),
        node({ id: 'c', position: { x: 300, y: 0 }, z: 3 }),
      ],
      [edge({ id: 'ab', source: 'a', target: 'b', blockId: 'bl' }), edge({ id: 'bc', source: 'b', target: 'c' })],
      { ba: textBlock('A'), bl: textBlock('label') },
    )
    const { board: out, ids } = A.duplicateSelection(b, ['a', 'b'])
    expect(ids).toHaveLength(3) // two nodes and the edge between them
    const [na, nb, ne] = ids
    expect(out.nodes[na].position).toEqual({ x: 30, y: 30 })
    expect(out.nodes[nb].position).toEqual({ x: 120, y: 30 })
    expect(out.nodes[na].locked).toBeUndefined()
    expect(out.nodes[na].blockId).not.toBe('ba')
    expect(out.blocks[out.nodes[na].blockId!]).toEqual(textBlock('A'))
    expect(out.blocks[out.nodes[na].blockId!]).not.toBe(b.blocks.ba)
    expect(out.edges[ne]).toMatchObject({ source: na, target: nb })
    expect(out.blocks[out.edges[ne].blockId!]).toEqual(textBlock('label'))
    expect(Math.min(out.nodes[na].z!, out.nodes[nb].z!)).toBeGreaterThan(3)
    expect(Object.keys(out.edges)).toHaveLength(3) // bc not copied
    expect(A.duplicate(b, ['c'], 60).nodes).not.toBe(b.nodes)
    expect(A.duplicate(b, [])).toBe(b)
  })

  test('clear board keeps viewport, readingOrder and unknown keys', () => {
    const b = board(
      [node({ id: 'a', blockId: 'ba' }), node({ id: 'b' })],
      [edge({ id: 'e', source: 'a', target: 'b' })],
      { ba: textBlock('x') },
      { viewport: { x: 1, y: 2, zoom: 0.5 }, readingOrder: ['a'], locked: true, 'x-future': { k: 1 } },
    )
    const out = A.clearBoard(b)
    expect(out).toEqual({
      version: 1,
      nodes: {},
      edges: {},
      blocks: {},
      viewport: { x: 1, y: 2, zoom: 0.5 },
      readingOrder: ['a'],
      locked: true,
      'x-future': { k: 1 },
    })
  })
})
