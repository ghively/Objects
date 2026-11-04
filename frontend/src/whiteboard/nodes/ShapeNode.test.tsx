import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { WhiteboardNode } from '@/api/whiteboardTypes'
import { CIRCUIT_TEXT, CIRCUIT_LABELS, SHAPES } from '../model'
import { shapePath } from '../shapes'
import { board, node, textBlock } from '../test/boards'
import { DEFAULT_SHAPE_FILL } from './ShapeNode'
import { angleFrom } from './NodeChrome'
import { renderBoard } from './test/harness'

const surface = (el: HTMLElement) => el.querySelector('[data-testid="whiteboard-shape-node"]') as HTMLElement

describe('ShapeNode', () => {
  // The app runs dark (`<html class="dark">`): shape colours use the dark values.
  beforeEach(() => document.documentElement.classList.add('dark'))
  afterEach(() => document.documentElement.classList.remove('dark'))

  test('test all 12 shapes render with fill, border, rotation and flip', () => {
    const nodes: WhiteboardNode[] = SHAPES.map((shape, i) =>
      node({
        id: `s-${shape}`,
        kind: 'shape',
        shape,
        position: { x: (i % 4) * 150, y: Math.floor(i / 4) * 150 },
        width: 120,
        height: 90,
        fillColor: 'bg-blue',
        borderColor: 'red',
        rotation: 30,
        flipX: true,
      }),
    )
    nodes.push(node({ id: 'plain', kind: 'shape', shape: 'ellipse', position: { x: 0, y: 600 }, width: 90, height: 90 }))
    const { nodeEl } = renderBoard(board(nodes))
    expect(SHAPES).toHaveLength(12)
    for (const shape of SHAPES) {
      const el = surface(nodeEl(`s-${shape}`)!)
      expect(el).toHaveAttribute('data-shape', shape)
      expect(el.style.transform).toBe('rotate(30deg)')
      expect(el).toHaveAttribute('data-flip-x')
      // Border: the ring custom property carries the theme colour (dark mode value).
      expect(el.style.getPropertyValue('--whiteboard-node-color-ring')).toBe('#F87171')
      const path = el.querySelector('svg path')!
      expect(path.getAttribute('d')).toBe(shapePath(shape, 120, 90, { flipX: true, flipY: false }))
      expect(path.getAttribute('fill')).toBe('#263956')
    }
    const plain = surface(nodeEl('plain')!)
    expect(plain.querySelector('svg path')!.getAttribute('fill')).toBe(DEFAULT_SHAPE_FILL)
    expect(plain.style.transform).toBe('')
    expect(plain.style.getPropertyValue('--whiteboard-node-color-ring')).toBe('')
    expect(plain).not.toHaveAttribute('data-flip-x')
  })

  test('test in-shape text vertical alignment', () => {
    const mk = (id: string, x: number, v?: WhiteboardNode['textVerticalAlign']) =>
      node({ id, kind: 'shape', shape: 'rectangle', blockId: `b-${id}`, position: { x, y: 0 }, width: 180, height: 180, ...(v ? { textVerticalAlign: v } : {}) })
    const { nodeEl } = renderBoard(
      board([mk('top', 0, 'top'), mk('mid', 200), mk('bot', 400, 'bottom')], [], {
        'b-top': textBlock('Top'),
        'b-mid': textBlock('Middle'),
        'b-bot': textBlock('Bottom', 'left'),
      }),
    )
    const text = (id: string) => nodeEl(id)!.querySelector('[data-testid="whiteboard-shape-text"]') as HTMLElement
    expect(text('top').style.justifyContent).toBe('flex-start')
    expect(text('top')).toHaveAttribute('data-text-valign', 'top')
    expect(text('mid').style.justifyContent).toBe('center')
    expect(text('bot').style.justifyContent).toBe('flex-end')
    expect(text('top')).toHaveTextContent('Top')
    // Shape text is centred unless the block says otherwise.
    expect((text('mid').querySelector('[data-whiteboard-text]') as HTMLElement).style.textAlign).toBe('center')
    expect((text('bot').querySelector('[data-whiteboard-text]') as HTMLElement).style.textAlign).toBe('left')
  })

  test('test gate labels render; HIGH and LOW have the circuit bit marker', () => {
    const nodes = CIRCUIT_LABELS.map((label, i) =>
      node({ id: `g-${label}`, kind: 'shape', shape: 'rectangle', blockId: `b-${label}`, position: { x: i * 120, y: 0 }, width: 90, height: 90 }),
    )
    const blocks = Object.fromEntries(CIRCUIT_LABELS.map((l) => [`b-${l}`, textBlock(CIRCUIT_TEXT[l])]))
    // Not a gate: an ellipse with a gate's text, and a rectangle with other text.
    nodes.push(node({ id: 'not-gate', kind: 'shape', shape: 'ellipse', blockId: 'b-x', position: { x: 0, y: 200 }, width: 90, height: 90 }))
    blocks['b-x'] = textBlock('AND')
    const { nodeEl } = renderBoard(board(nodes, [], blocks))
    for (const label of CIRCUIT_LABELS) {
      const el = surface(nodeEl(`g-${label}`)!)
      expect(el).toHaveAttribute('data-gate', label)
      expect(el.querySelector('[data-gate-label]')).toHaveTextContent(CIRCUIT_TEXT[label])
      if (label === 'high') expect(el).toHaveAttribute('data-circuit-bit', '1')
      else if (label === 'low') expect(el).toHaveAttribute('data-circuit-bit', '0')
      else expect(el).not.toHaveAttribute('data-circuit-bit')
    }
    expect(surface(nodeEl('not-gate')!)).not.toHaveAttribute('data-gate')
  })

  test('rotation knob shows on a selected shape and the angle helper measures from straight up', () => {
    const n = node({ id: 's', kind: 'shape', shape: 'star', width: 90, height: 90 })
    const { nodeEl, store } = renderBoard(board([n]))
    expect(nodeEl('s')!.querySelector('[data-whiteboard-rotate]')).toBeNull()
    act(() => store.getState().actions.select(['s']))
    expect(nodeEl('s')!.querySelector('[data-whiteboard-rotate]')).toBeTruthy()
    expect(angleFrom({ x: 0, y: 0 }, { x: 0, y: -10 })).toBe(0)
    expect(angleFrom({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(90)
    expect(angleFrom({ x: 0, y: 0 }, { x: -10, y: 0 })).toBe(270)
    expect(angleFrom({ x: 0, y: 0 }, { x: 10, y: -9 }, 15)).toBe(45)
  })
})
