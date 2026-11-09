import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import * as M from './model'
import { OBJECT_DRAG_MIME, mayCarryObject, readDroppedObject } from './dnd'
import { DOTTED_PLAN, NETWORK_MAP, board, node, textBlock } from './test/boards'

describe('whiteboard model', () => {
  test('test sizes are whole grid cells', () => {
    expect([M.GRID, M.GRID_HALF]).toEqual([30, 15])
    const inCells = (v: number) => v / M.GRID
    expect([M.DEFAULT_NODE_WIDTH, M.DEFAULT_NODE_HEIGHT].map(inCells)).toEqual([13, 2])
    expect(M.AUTO_MIN_WIDTH).toBe(M.DEFAULT_NODE_WIDTH)
    expect([M.AUTO_MAX_WIDTH, M.AUTO_MAX_HEIGHT].map(inCells)).toEqual([20, 16])
    expect(M.AUTO_TEXT_MIN_HEIGHT).toBe(M.DEFAULT_NODE_HEIGHT)
    expect(inCells(M.LINK_BLOCK_MIN_WIDTH)).toBe(12)
    expect([M.MIN_BLOCK_WIDTH, M.MIN_BLOCK_HEIGHT].map(inCells)).toEqual([2, 1])
    expect([M.MIN_SHAPE_WIDTH, M.MIN_SHAPE_HEIGHT].map(inCells)).toEqual([3, 3])
    expect([M.DEFAULT_CIRCUIT_WIDTH, M.DEFAULT_CIRCUIT_HEIGHT]).toEqual([M.MIN_SHAPE_WIDTH, M.MIN_SHAPE_HEIGHT])
    expect([M.DEFAULT_FRAME_WIDTH, M.DEFAULT_FRAME_HEIGHT].map(inCells)).toEqual([20, 12])
    expect([M.EMBED_CAPTION_HEIGHT, M.EMBED_CAPTION_GAP]).toEqual([M.GRID, 6])
    expect(M.CONTENT_Z_MIN).toBe(1)
  })

  test('test the pixel values the M6 plan states', () => {
    // The literal numbers the M6 plan and m6-acceptance.md quote (whole grid cells since PR #13).
    // A refactor that moves one of them must change the plan and this test together.
    expect([M.DEFAULT_NODE_WIDTH, M.DEFAULT_NODE_HEIGHT]).toEqual([390, 60])
    expect([M.AUTO_MAX_WIDTH, M.AUTO_MAX_HEIGHT]).toEqual([600, 480])
    expect([M.MIN_BLOCK_WIDTH, M.MIN_BLOCK_HEIGHT]).toEqual([60, 30])
    expect([M.MIN_SHAPE_WIDTH, M.MIN_SHAPE_HEIGHT]).toEqual([90, 90])
    expect(M.LINK_BLOCK_MIN_WIDTH).toBe(360)
    expect([M.DEFAULT_FRAME_WIDTH, M.DEFAULT_FRAME_HEIGHT]).toEqual([600, 360])
    expect(M.ZOOM_PRESETS).toEqual([0.05, 0.1, 0.2, 0.33, 0.5, 0.75, 1, 1.25, 1.6, 2, 3])
    expect(M.CIRCUIT_LABELS).toEqual(['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'high', 'low'])
  })

  test('test zoom stops climb from the minimum to the maximum', () => {
    const stops = [M.ZOOM_MIN, ...M.ZOOM_PRESETS, M.ZOOM_MAX]
    for (let i = 1; i < stops.length; i++) expect(stops[i]).toBeGreaterThan(stops[i - 1])
    expect(M.ZOOM_PRESETS).toContain(1)
  })

  test('test the vocabulary', () => {
    expect([...M.NODE_KINDS].sort()).toEqual(['block', 'frame', 'point', 'shape'])
    // The design spec's twelve shapes, each one known to the shape guards.
    expect(M.SHAPES).toHaveLength(12)
    expect(new Set(M.SHAPES).size).toBe(12)
    for (const s of M.SHAPES) expect(M.isShapeTool(s)).toBe(true)
    // Pickers: every shape but the three kept only for drawing old boards, rectangle first.
    expect(M.PICKER_SHAPES).toHaveLength(9)
    expect(M.PICKER_SHAPES[0]).toBe('rectangle')
    for (const hidden of ['roundedRectangle', 'triangleDown', 'blockArrowLeft']) expect(M.isPickerShape(hidden)).toBe(false)
    expect(M.SHAPE_MENU_TOOLS).toEqual([...M.CONNECTOR_TOOLS, ...M.PICKER_SHAPES])
    expect(M.CONNECTOR_TOOLS).toEqual(['line', 'arrow'])

    // Gates: stored as their name in capitals.
    expect(M.CIRCUIT_LABELS).toHaveLength(9)
    for (const g of M.CIRCUIT_LABELS) expect(M.CIRCUIT_TEXT[g]).toBe(g.toUpperCase())
    expect(M.CIRCUIT_IO).toEqual(['high', 'low'])

    expect(M.PICKER_MARKERS).toEqual(['none', 'arrow', 'dot', 'double'])
    expect([...M.MARKERS].sort()).toEqual(['arrow', 'arrowClosed', 'dot', 'double', 'none'])
    expect([...M.CONNECTIONS].sort()).toEqual(['cornered', 'curved', 'straight'])
    expect([...M.LINES].sort()).toEqual(['dashed', 'dotted', 'solid'])
    expect(M.POINTER_TOOLS).toEqual(['select', 'hand'])
    expect(M.MEDIA_TOOLS).toEqual(['image', 'pdf', 'audio', 'file', 'weblink'])
    expect(M.PICKER_TOOLS).toEqual(['link', 'create', ...M.MEDIA_TOOLS])

    // Tools: every kind of tool once; all but Move and Hand are one-shot.
    expect(new Set(M.TOOLS).size).toBe(M.TOOLS.length)
    for (const group of [M.POINTER_TOOLS, M.PICKER_TOOLS, M.CONNECTOR_TOOLS, M.SHAPES, M.CIRCUIT_LABELS, ['text', 'frame'] as const]) {
      for (const t of group) expect(M.isTool(t)).toBe(true)
    }
    expect(M.TOOLS).toHaveLength(2 + 7 + 2 + 12 + 9 + 2)
    expect(M.ONE_SHOT_TOOLS).toHaveLength(M.TOOLS.length - 2)
    expect(M.isOneShotTool('select')).toBe(false)
    expect(M.isOneShotTool('hand')).toBe(false)
    expect(M.isOneShotTool('weblink')).toBe(true)
    expect(M.isOneShotTool('nand')).toBe(true)

    expect(M.DEFAULT_SETTINGS).toEqual({
      isSnappingToGrid: true,
      isSnappingToNodes: true,
      isShowingDots: true,
      isZoomingOnScroll: true,
      isEngineeringMode: false,
    })
    expect(M.emptyBoard()).toEqual({ version: 1, nodes: {}, edges: {}, blocks: {} })
  })

  test('test connector style defaults and dash patterns', () => {
    expect(M.normalizeConnection(undefined)).toBe('cornered')
    expect(M.normalizeConnection('straight')).toBe('straight')
    expect(M.normalizeConnection('curved')).toBe('curved')
    expect(M.normalizeConnection('bogus' as never)).toBe('cornered')
    expect(M.normalizeLine(undefined)).toBe('solid')
    expect(M.normalizeLine('dashed')).toBe('dashed')
    expect(M.normalizeLine('dotted')).toBe('dotted')
    expect(M.normalizeMarker('arrowClosed')).toBe('arrow')
    expect(M.normalizeMarker('arrow')).toBe('arrow')
    expect(M.normalizeMarker('dot')).toBe('dot')
    expect(M.normalizeMarker('double')).toBe('double')
    expect(M.normalizeMarker(undefined)).toBe('none')
    expect(M.dasharray(undefined)).toBeUndefined()
    expect(M.dasharray('solid')).toBeUndefined()
    expect(M.dasharray('dashed')).toBe('8 8')
    expect(M.dasharray('dotted')).toBe('0 10')
    expect(M.rememberedEdgeStyle(undefined, undefined)).toEqual({})
    expect(M.rememberedEdgeStyle('curved', undefined)).toEqual({ connection: 'curved' })
    expect(M.rememberedEdgeStyle('straight', 'dotted')).toEqual({ connection: 'straight', line: 'dotted' })
  })

  test('test snapBox lands both edges on the grid with the floor', () => {
    expect(M.snap(44)).toBe(30)
    expect(M.snap(46)).toBe(60)
    expect(M.snap(Number.NaN)).toBe(0)
    expect(M.snapPosition({ x: 14, y: -16 })).toEqual({ x: 0, y: -30 })
    expect(M.snapSpanMin(0)).toBe(30)
    expect(M.snapSpanMin(40)).toBe(60)
    expect(M.snapSpanMin(90)).toBe(90)
    // Both edges on the grid.
    expect(M.snapBox({ x: 13, y: 47, width: 200, height: 101 })).toEqual({ x: 0, y: 60, width: 210, height: 90 })
    // The floor applies when the drawn box is smaller.
    expect(M.snapBox({ x: 31, y: 31, width: 10, height: 10 }, M.minSizeFor('shape'))).toEqual({ x: 30, y: 30, width: 90, height: 90 })
    expect(M.snapBox({ x: 0, y: 0, width: 5, height: 5 }, M.minSizeFor('block'))).toEqual({ x: 0, y: 0, width: 60, height: 30 })
    expect(M.snapBox({ x: 0, y: 0, width: 5, height: 5 })).toEqual({ x: 0, y: 0, width: 30, height: 30 })
    expect(M.minSizeFor('point')).toEqual({ width: 0, height: 0 })
    expect(M.minSizeFor('frame')).toEqual({ width: 90, height: 90 })
    expect(M.connectorFromNodeBox({ x: 30, y: 60, width: 90, height: 60 })).toEqual({ start: { x: 30, y: 90 }, end: { x: 120, y: 90 } })
  })

  test('test z rules', () => {
    // Content z ≥ 1 and above other content; frames don't count.
    expect(M.nextContentZ([])).toBe(1)
    expect(M.nextContentZ([{ kind: 'frame', z: 50 }])).toBe(1)
    expect(M.nextContentZ([{ kind: 'shape', z: 4 }, { kind: 'block', z: 9 }, { kind: 'frame', z: 99 }])).toBe(10)
    expect(M.nextContentZ([{ kind: 'block', z: -5 }])).toBe(1)
    // A new frame goes below every frame, and below content.
    expect(M.nextFrameZ([])).toBe(0)
    expect(M.nextFrameZ([{ kind: 'block', z: 1 }])).toBe(0)
    expect(M.nextFrameZ([{ kind: 'frame', z: -2 }, { kind: 'frame', z: 0 }])).toBe(-3)
    const nm = Object.values(NETWORK_MAP.nodes)
    expect(M.nextFrameZ(nm)).toBeLessThan(Math.min(...nm.filter((n) => n.kind === 'frame').map((n) => n.z ?? 0)))
    // Send to back stays above frames.
    const nodes = [
      { id: 'f', kind: 'frame', z: 0 },
      { id: 'a', kind: 'block', z: 1 },
      { id: 'b', kind: 'block', z: 2 },
      { id: 'c', kind: 'shape', z: 5 },
    ]
    expect(M.contentSendToBackStartZ(nodes, ['c'])).toBe(1)
    expect(M.contentSendToBackStartZ([...nodes.slice(0, 1), { id: 'a', kind: 'block', z: 10 }, nodes[3]], ['c'])).toBe(9)
    expect(M.contentSendToBackStartZ(nodes, ['f'])).toBe(1)
    expect(M.contentSendToBackStartZ([{ id: 'x', kind: 'block', z: 3 }], ['x'])).toBe(1)
  })

  test('test next frame title skips used numbers and ignores custom titles', () => {
    expect(M.nextFrameTitle([])).toBe('Frame 1')
    expect(M.nextFrameTitle([{ kind: 'frame', title: 'Frame 1' }, { kind: 'frame', title: 'Frame 3' }])).toBe('Frame 2')
    expect(M.nextFrameTitle([{ kind: 'frame', title: 'Core' }, { kind: 'frame', title: ' Frame 1 ' }])).toBe('Frame 2')
    expect(M.nextFrameTitle([{ kind: 'frame', title: 'Frame 1 notes' }])).toBe('Frame 1')
    // Only frames count.
    expect(M.nextFrameTitle([{ kind: 'block', title: 'Frame 1' }])).toBe('Frame 1')
    expect(M.nextFrameTitle(Object.values(NETWORK_MAP.nodes))).toBe('Frame 2')
  })

  test('test which tool each button arms, and the tool a board opens with', () => {
    expect(M.resolvePointerTool()).toBe('select')
    expect(M.resolvePointerTool('hand')).toBe('hand')
    expect(M.resolvePointerTool(undefined, 'hand')).toBe('hand')
    expect(M.resolvePointerTool('text', 'rectangle')).toBe('select')
    expect(M.resolveShapeMenuTool()).toBe('rectangle')
    expect(M.resolveShapeMenuTool('arrow')).toBe('arrow')
    expect(M.resolveShapeMenuTool(undefined, 'heart')).toBe('heart')
    expect(M.resolveShapeMenuTool(undefined, 'text', 'star')).toBe('star')
    // Shapes outside the picker never come back from the Shapes button.
    expect(M.resolveShapeMenuTool('roundedRectangle', 'triangleDown', 'blockArrowLeft')).toBe('rectangle')
    expect(M.resolveWhiteboardMediaTool()).toBe('image')
    expect(M.resolveWhiteboardMediaTool('text', 'audio')).toBe('audio')
    expect(M.resolveCircuitTool()).toBe('nand')
    expect(M.resolveCircuitTool('xor')).toBe('xor')
    expect(M.resolveCircuitTool(undefined, 'low')).toBe('low')
    expect(M.resolveLastUsedTool(undefined)).toBe('select')
    expect(M.resolveLastUsedTool('frame')).toBe('frame')
    expect(M.resolveLastUsedTool('nand', false)).toBe('select')
    expect(M.resolveLastUsedTool('nand', true)).toBe('nand')
    expect(M.resolveLastUsedTool('image')).toBe('image')
    expect(M.resolveLastUsedTool('weblink')).toBe('weblink')
    expect(M.resolveLastUsedTool('nonsense')).toBe('select')
  })

  test('test gates are rectangles with an exact label; points are not connectable', () => {
    const blocks = NETWORK_MAP.blocks
    for (const label of M.CIRCUIT_LABELS) {
      expect(M.circuitLabelOf(NETWORK_MAP.nodes[`n-gate-${label}`], blocks)).toBe(label)
    }
    expect(M.isCircuitNode(NETWORK_MAP.nodes['n-shape-rectangle'], blocks)).toBe(false)
    expect(M.isCircuitNode(NETWORK_MAP.nodes['n-text'], blocks)).toBe(false)
    const b = board([node({ id: 'e', kind: 'shape', shape: 'ellipse', blockId: 't' })], [], { t: textBlock('AND') })
    expect(M.isCircuitNode(b.nodes.e, b.blocks)).toBe(false)
    const lower = board([node({ id: 'r', kind: 'shape', shape: 'rectangle', blockId: 't' })], [], { t: textBlock('and') })
    expect(M.isCircuitNode(lower.nodes.r, lower.blocks)).toBe(false)
    expect(M.isConnectable({ kind: 'point' })).toBe(false)
    expect(M.isConnectable({ kind: 'frame' })).toBe(true)
    expect(M.isConnectable(undefined)).toBe(false)
  })

  test('test the test boards mirror the backend fixture files', () => {
    const dir = path.resolve(import.meta.dirname, '../../../backend/tests/fixtures/space-whiteboard/Whiteboards')
    expect(JSON.parse(readFileSync(path.join(dir, 'Network map.whiteboard.json'), 'utf8'))).toEqual(NETWORK_MAP)
    expect(JSON.parse(readFileSync(path.join(dir, 'Dotted v1.2 plan.whiteboard.json'), 'utf8'))).toEqual(DOTTED_PLAN)
  })
})

function transfer(data: Record<string, string>) {
  return { getData: (f: string) => data[f] ?? '', types: Object.keys(data) }
}

describe('dnd', () => {
  test('test dropped object reader accepts the mime and a plain wikilink', () => {
    expect(OBJECT_DRAG_MIME).toBe('application/x-object-path')
    expect(readDroppedObject(transfer({ [OBJECT_DRAG_MIME]: 'Pages/Router A.md', 'text/plain': '[[Other]]' }))).toEqual({
      path: 'Pages/Router A.md',
    })
    expect(readDroppedObject(transfer({ 'text/plain': '  [[Router B]]\n' }))).toEqual({ link: '[[Router B]]' })
    expect(readDroppedObject(transfer({ 'text/plain': 'see [[Router B]]' }))).toBeNull()
    expect(readDroppedObject(transfer({ 'text/plain': '[[A]] [[B]]' }))).toBeNull()
    expect(readDroppedObject(transfer({ 'text/plain': 'plain text' }))).toBeNull()
    expect(readDroppedObject(transfer({}))).toBeNull()
    expect(readDroppedObject(null)).toBeNull()
    expect(readDroppedObject({ getData: () => { throw new Error('protected') } })).toBeNull()
    expect(mayCarryObject(transfer({ [OBJECT_DRAG_MIME]: 'x' }))).toBe(true)
    expect(mayCarryObject(transfer({ 'Files': 'x' }))).toBe(false)
  })
})
