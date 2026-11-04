import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { board, node } from '../test/boards'
import { renderBoard } from './test/harness'

describe('FrameNode', () => {
  test('test frame title shows and edits; dashed border', () => {
    const f = node({ id: 'f', kind: 'frame', title: 'Frame 1', position: { x: 0, y: 0 }, width: 480, height: 420, z: 0 })
    const g = node({ id: 'g', kind: 'frame', position: { x: 600, y: 0 }, width: 480, height: 420, z: -1, fillColor: 'bg-green' })
    const { nodeEl, store } = renderBoard(board([f, g]))

    const surface = nodeEl('f')!.querySelector('[data-testid="whiteboard-frame-node"]') as HTMLElement
    // The dashed 3px border is the rule on `.react-flow__node-boardFrame .whiteboard-shape-surface`.
    expect(surface).toHaveClass('whiteboard-shape-surface')
    expect(nodeEl('f')).toHaveClass('react-flow__node-boardFrame')
    expect(surface.style.background).toBe('transparent')
    expect((nodeEl('g')!.querySelector('[data-testid="whiteboard-frame-node"]') as HTMLElement).style.backgroundColor).not.toBe('')

    const title = nodeEl('f')!.querySelector('[data-testid="whiteboard-frame-title"]') as HTMLElement
    expect(title).toHaveTextContent('Frame 1')
    expect(nodeEl('g')!.querySelector('[data-testid="whiteboard-frame-title"]')).toBeNull()

    fireEvent.doubleClick(title)
    const input = screen.getByRole('textbox', { name: 'Frame' }) as HTMLInputElement
    expect(input.value).toBe('Frame 1')
    fireEvent.change(input, { target: { value: 'Core network' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(store.getState().doc.board.nodes.f.title).toBe('Core network')
    expect(nodeEl('f')!.querySelector('[data-testid="whiteboard-frame-title"]')).toHaveTextContent('Core network')

    // Escape cancels.
    fireEvent.doubleClick(nodeEl('f')!.querySelector('[data-testid="whiteboard-frame-title"]')!)
    const again = screen.getByRole('textbox', { name: 'Frame' })
    fireEvent.change(again, { target: { value: 'Nope' } })
    fireEvent.keyDown(again, { key: 'Escape' })
    expect(store.getState().doc.board.nodes.f.title).toBe('Core network')

    // Emptying the title removes it.
    fireEvent.doubleClick(nodeEl('f')!.querySelector('[data-testid="whiteboard-frame-title"]')!)
    const third = screen.getByRole('textbox', { name: 'Frame' })
    fireEvent.change(third, { target: { value: '  ' } })
    act(() => {
      fireEvent.blur(third)
    })
    expect('title' in store.getState().doc.board.nodes.f).toBe(false)
    expect(nodeEl('f')!.querySelector('[data-testid="whiteboard-frame-title"]')).toBeNull()
  })
})
