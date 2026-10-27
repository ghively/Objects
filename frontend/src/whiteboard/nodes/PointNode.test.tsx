import { act } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { isConnectable } from '../model'
import { board, edge, node, textBlock } from '../test/boards'
import { renderBoard } from './test/harness'

const visibleHandles = (el: HTMLElement) => el.querySelectorAll('[data-whiteboard-handle]')
const connectable = (el: HTMLElement) => el.querySelectorAll('.react-flow__handle.connectable')

describe('PointNode', () => {
  test('test point has no handles and is not connectable', () => {
    const p = node({ id: 'p', kind: 'point', position: { x: 100, y: 100 } })
    const q = node({ id: 'q', kind: 'point', position: { x: 300, y: 100 } })
    const s = node({ id: 's', kind: 'shape', shape: 'rectangle', position: { x: 0, y: 300 }, width: 90, height: 90 })
    const { nodeEl, store } = renderBoard(board([p, q, s], [edge({ id: 'e', source: 'p', target: 'q' })]))

    const point = nodeEl('p')!
    expect(point.querySelector('[data-testid="whiteboard-point-node"]')).toBeTruthy()
    expect(visibleHandles(point)).toHaveLength(0)
    expect(connectable(point)).toHaveLength(0)
    // It still anchors connector ends (one hidden source and target).
    expect(point.querySelectorAll('.react-flow__handle')).toHaveLength(2)
    expect(isConnectable(p)).toBe(false)

    // A shape has the four handles, each as a target and a source.
    expect([...visibleHandles(nodeEl('s')!)].map((h) => h.getAttribute('data-whiteboard-handle'))).toEqual(['top', 'right', 'bottom', 'left'])
    expect(nodeEl('s')!.querySelectorAll('.react-flow__handle')).toHaveLength(8)

    // The dot shows only while selected; no resizer.
    const dot = () => (point.querySelector('[data-testid="whiteboard-point-node"] span') as HTMLElement).style.opacity
    expect(dot()).toBe('0')
    act(() => store.getState().actions.select(['p']))
    expect(dot()).toBe('1')
    expect(point.querySelector('.react-flow__resize-control')).toBeNull()
  })
})

describe('locked', () => {
  test('test locked board hides handles and resizers', () => {
    const t = node({ id: 't', blockId: 'b', width: 420, height: 60 })
    const s = node({ id: 's', kind: 'shape', shape: 'rectangle', position: { x: 0, y: 200 }, width: 90, height: 90 })
    const nodes = [t, s]
    const unlocked = renderBoard(board(nodes, [], { b: textBlock('Hi') }), { selection: ['t', 's'] })
    expect(visibleHandles(unlocked.nodeEl('s')!)).toHaveLength(4)
    expect(unlocked.nodeEl('t')!.querySelector('.react-flow__resize-control')).toBeTruthy()
    expect(unlocked.nodeEl('s')!.querySelector('[data-whiteboard-rotate]')).toBeTruthy()
    unlocked.unmount()

    const locked = renderBoard(board(nodes, [], { b: textBlock('Hi') }, { locked: true }))
    act(() => locked.store.setState({ selection: ['t', 's'] }))
    for (const id of ['t', 's']) {
      const el = locked.nodeEl(id)!
      expect(el).toHaveClass('selected')
      expect(visibleHandles(el)).toHaveLength(0)
      expect(connectable(el)).toHaveLength(0)
      expect(el.querySelector('.react-flow__resize-control')).toBeNull()
      expect(el.querySelector('[data-whiteboard-rotate]')).toBeNull()
    }
    locked.unmount()

    // A locked node on an unlocked board is inert too.
    const one = renderBoard(board([{ ...s, locked: true }]), { selection: ['s'] })
    expect(visibleHandles(one.nodeEl('s')!)).toHaveLength(0)
    expect(one.nodeEl('s')!.querySelector('.react-flow__resize-control')).toBeNull()
  })
})
