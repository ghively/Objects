import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { board, node, textBlock } from '../test/boards'
import { renderBoard } from './test/harness'

const resizerProps: { minWidth?: number; minHeight?: number }[] = []

vi.mock('@xyflow/react', async (orig) => {
  const real = await orig<typeof import('@xyflow/react')>()
  return {
    ...real,
    NodeResizer: (p: { minWidth?: number; minHeight?: number }) => {
      resizerProps.push(p)
      return <div data-testid="node-resizer" data-min-width={p.minWidth} data-min-height={p.minHeight} />
    },
  }
})

describe('BlockNode', () => {
  test('test text node auto sizes until resized; resize respects the 40 × 30 floor', () => {
    const auto = node({ id: 'auto', blockId: 'b1', position: { x: 0, y: 0 } })
    const pinned = node({ id: 'pinned', blockId: 'b2', position: { x: 0, y: 300 }, width: 300, height: 90 })
    const { nodeEl, store } = renderBoard(board([auto, pinned], [], { b1: textBlock('Hello'), b2: textBlock('Pinned') }))

    const autoFrame = nodeEl('auto')!.querySelector('[data-testid="whiteboard-text-node"]') as HTMLElement
    expect(autoFrame).toHaveAttribute('data-auto-size')
    expect(autoFrame.style.minWidth).toBe('420px')
    expect(autoFrame.style.maxWidth).toBe('480px')
    expect(autoFrame.style.minHeight).toBe('60px')
    expect(autoFrame.style.maxHeight).toBe('420px')
    expect(autoFrame.style.width).toBe('max-content')

    const pinnedFrame = nodeEl('pinned')!.querySelector('[data-testid="whiteboard-text-node"]') as HTMLElement
    expect(pinnedFrame).not.toHaveAttribute('data-auto-size')
    expect(pinnedFrame.style.width).toBe('100%')
    expect(pinnedFrame.style.height).toBe('100%')
    expect(pinnedFrame.style.maxWidth).toBe('')

    // Selecting shows the resizer with the block floor.
    expect(screen.queryByTestId('node-resizer')).toBeNull()
    act(() => store.getState().actions.select(['auto']))
    const resizer = screen.getByTestId('node-resizer')
    expect(resizer).toHaveAttribute('data-min-width', '40')
    expect(resizer).toHaveAttribute('data-min-height', '30')

    // A resize pins the size: the node no longer hugs its content.
    act(() =>
      store.getState().canvas.applyFlowChanges([
        { type: 'dimensions', id: 'auto', dimensions: { width: 200, height: 90 }, resizing: true, setAttributes: true },
      ]),
    )
    expect(store.getState().doc.board.nodes.auto).toMatchObject({ width: 200, height: 90 })
    const after = nodeEl('auto')!.querySelector('[data-testid="whiteboard-text-node"]') as HTMLElement
    expect(after).not.toHaveAttribute('data-auto-size')
  })

  test('test double click edits text and commits one setBlock on blur', async () => {
    const n = node({ id: 't', blockId: 'b', width: 420, height: 60, 'x-keep': 1 })
    const { nodeEl, store } = renderBoard(board([n], [], { b: { ...textBlock('Hello', 'center'), 'x-extra': true } }))
    const setBlock = vi.spyOn(store.getState().actions, 'setBlock')
    expect(nodeEl('t')!).toHaveTextContent('Hello')

    fireEvent.doubleClick(nodeEl('t')!.querySelector('[data-testid="whiteboard-text-node"]')!)
    expect(store.getState().editingId).toBe('t')
    const editor = await waitFor(() => {
      const el = nodeEl('t')!.querySelector('.ProseMirror') as HTMLElement
      expect(el).toBeTruthy()
      return el
    })
    const tiptap = (editor as unknown as { editor?: { commands: { insertContent(s: string): void; focus(p: string): void } } })
      .editor
    act(() => {
      tiptap!.commands.focus('end')
      tiptap!.commands.insertContent(' world')
    })
    const undoBefore = store.getState().canUndo
    expect(undoBefore).toBe(false)
    act(() => {
      fireEvent.blur(editor)
      fireEvent.focusOut(editor)
    })
    expect(setBlock).toHaveBeenCalledTimes(1)
    expect(store.getState().editingId).toBeNull()
    const b = store.getState().doc.board.blocks.b
    expect(b).toEqual({ type: 'text', markdown: 'Hello world', align: 'center', 'x-extra': true })
    expect(store.getState().canUndo).toBe(true)
    act(() => store.getState().actions.undo())
    expect(store.getState().doc.board.blocks.b).toMatchObject({ markdown: 'Hello' })
    expect(store.getState().canUndo).toBe(false)
  })

  test('escape commits unchanged text without a step', async () => {
    const n = node({ id: 't', blockId: 'b', width: 420, height: 60 })
    const { nodeEl, store } = renderBoard(board([n], [], { b: textBlock('Same **bold** [[Router A|Router]]') }))
    expect(nodeEl('t')!.querySelector('strong')).toHaveTextContent('bold')
    expect(nodeEl('t')!.querySelector('[data-wikilink]')).toHaveTextContent('Router')
    const setBlock = vi.spyOn(store.getState().actions, 'setBlock')
    fireEvent.doubleClick(nodeEl('t')!.querySelector('[data-testid="whiteboard-text-node"]')!)
    const editor = await waitFor(() => nodeEl('t')!.querySelector('.ProseMirror') as HTMLElement)
    expect(editor).toBeTruthy()
    act(() => {
      fireEvent.keyDown(editor, { key: 'Escape' })
    })
    expect(store.getState().editingId).toBeNull()
    expect(setBlock).not.toHaveBeenCalled()
    expect(store.getState().canUndo).toBe(false)
  })

  test('double click does nothing on a locked board', () => {
    const n = node({ id: 't', blockId: 'b', width: 420, height: 60 })
    const { nodeEl, store } = renderBoard(board([n], [], { b: textBlock('Hi') }, { locked: true }))
    fireEvent.doubleClick(nodeEl('t')!.querySelector('[data-testid="whiteboard-text-node"]')!)
    expect(store.getState().editingId).toBeNull()
  })
})
