import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import type { WhiteboardData, WhiteboardNode } from '@/api/whiteboardTypes'
import { board, node, textBlock } from '../test/boards'
import { fakeActions } from './fakeActions'
import { ORDER_LABEL, SelectionToolbar } from './SelectionToolbar'

function setup(b: WhiteboardData, selected: string[]) {
  const { actions, state } = fakeActions(b)
  const nodes = selected.map((id) => b.nodes[id]).filter(Boolean) as WhiteboardNode[]
  const edges = selected.map((id) => b.edges[id]).filter(Boolean)
  render(<SelectionToolbar nodes={nodes} edges={edges} blocks={b.blocks} actions={actions} />)
  return { actions, state }
}

function renderOnly(b: WhiteboardData, selected: string[]) {
  const { actions } = fakeActions(b)
  const nodes = selected.map((id) => b.nodes[id]).filter(Boolean) as WhiteboardNode[]
  return render(<SelectionToolbar nodes={nodes} edges={[]} blocks={b.blocks} actions={actions} />)
}

function controls(): string[] {
  return within(screen.getByRole('toolbar'))
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? '')
}

const text = node({ id: 't', kind: 'block', blockId: 'bt', position: { x: 0, y: 0 }, width: 420, height: 60 })
const shape = node({ id: 's', kind: 'shape', shape: 'star', position: { x: 600, y: 0 }, width: 90, height: 90 })
const frame = node({ id: 'f', kind: 'frame', position: { x: 0, y: 300 }, width: 480, height: 420, title: 'Frame 1' })
const plainFrame = node({ id: 'g', kind: 'frame', position: { x: 900, y: 300 }, width: 480, height: 420 })
const locked = node({ id: 'l', kind: 'shape', shape: 'rectangle', position: { x: 0, y: 900 }, width: 90, height: 90, locked: true })
const gate = node({ id: 'x', kind: 'shape', shape: 'rectangle', blockId: 'bx', position: { x: 300, y: 900 }, width: 90, height: 90 })
const B = board([text, shape, frame, plainFrame, locked, gate], [], { bt: textBlock('Hello'), bx: textBlock('NAND') })

describe('SelectionToolbar', () => {
  test('test selection toolbar shows the controls that apply to the selection', () => {
    const cases: [string[], string[]][] = [
      // Text only: colour, text alignment, order, duplicate, wrap, delete. No fill, flip or align.
      [['t'], ['Color', 'Text alignment', ORDER_LABEL, 'Duplicate', 'Wrap in new frame', 'Delete']],
      [['s'], ['Color', 'Fill', 'Text alignment', 'Flip', ORDER_LABEL, 'Duplicate', 'Wrap in new frame', 'Delete']],
      [['f'], ['Color', 'Fill', ORDER_LABEL, 'Duplicate', 'Wrap in new frame', 'Remove frame title', 'Delete']],
      [['t', 's', 'f'], ['Color', 'Fill', 'Text alignment', 'Flip', 'Align', ORDER_LABEL, 'Duplicate', 'Wrap in new frame', 'Delete']],
      [['l'], ['Duplicate']],
    ]
    for (const [sel, expected] of cases) {
      const { unmount } = renderOnly(B, sel)
      expect(controls()).toEqual(expected)
      unmount()
    }
  })

  test('shape selection adds fill and flip', () => {
    setup(B, ['s'])
    expect(controls()).toEqual(['Color', 'Fill', 'Text alignment', 'Flip', ORDER_LABEL, 'Duplicate', 'Wrap in new frame', 'Delete'])
  })

  test('one frame: fill and the frame title control', () => {
    setup(B, ['f'])
    expect(controls()).toEqual(['Color', 'Fill', ORDER_LABEL, 'Duplicate', 'Wrap in new frame', 'Remove frame title', 'Delete'])
  })

  test('one untitled frame offers Add frame title', async () => {
    const { actions } = setup(B, ['g'])
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add frame title' }))
    expect(actions.addFrameTitle).toHaveBeenCalledWith('g')
  })

  test('several nodes add Align and drop the frame title control', async () => {
    const user = userEvent.setup()
    const { actions } = setup(B, ['t', 's', 'f'])
    expect(controls()).toContain('Align')
    expect(controls()).not.toContain('Remove frame title')
    await user.click(screen.getByRole('button', { name: 'Align' }))
    const items = within(screen.getByRole('menu', { name: 'Align' })).getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual([
      'Place left',
      'Place center',
      'Place right',
      'Place top',
      'Place middle',
      'Place bottom',
      'Place in a row',
      'Place in a column',
      'Place in a grid',
    ])
    await user.click(screen.getByRole('menuitem', { name: 'Place in a grid' }))
    expect(actions.place).toHaveBeenCalledWith('grid', ['t', 's', 'f'])
  })

  test('a locked node only offers Duplicate; locked nodes are left out of edits', async () => {
    setup(B, ['l'])
    expect(controls()).toEqual(['Duplicate'])
  })

  test('locked nodes are left out of a mixed selection', async () => {
    const user = userEvent.setup()
    const { actions } = setup(B, ['s', 'l'])
    expect(controls()).not.toContain('Align') // only one editable node
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(actions.removeSelection).toHaveBeenCalledWith(['s'])
  })

  test('gates take no text alignment', () => {
    setup(B, ['x'])
    expect(controls()).not.toContain('Text alignment')
  })

  test('colour and fill write every target in one step and remember the colour', async () => {
    const user = userEvent.setup()
    const { actions, state } = setup(B, ['s', 'f', 't'])
    await user.click(screen.getByRole('button', { name: 'Color' }))
    await user.click(screen.getByRole('button', { name: 'Blue' }))
    expect(actions.apply).toHaveBeenCalledTimes(1)
    expect(state.board.nodes.s.borderColor).toBe('blue')
    expect(state.board.nodes.f.borderColor).toBe('blue')
    expect(state.board.nodes.t.borderColor).toBe('blue')
    expect(actions.remember).toHaveBeenCalledWith({ lastBorderColor: 'blue' })

    await user.click(screen.getByRole('button', { name: 'Fill' }))
    await user.click(screen.getByRole('button', { name: 'Teal' }))
    expect(actions.apply).toHaveBeenCalledTimes(2)
    expect(state.board.nodes.s.fillColor).toBe('bg-teal')
    expect(state.board.nodes.f.fillColor).toBe('bg-teal')
    expect(state.board.nodes.t.fillColor).toBeUndefined()
    expect(actions.remember).toHaveBeenCalledWith({ lastFillColor: 'bg-teal' })
  })

  test('text alignment writes the text block and keeps its Markdown', async () => {
    const user = userEvent.setup()
    const { state } = setup(B, ['t', 's'])
    await user.click(screen.getByRole('button', { name: 'Text alignment' }))
    expect(within(screen.getByRole('menu', { name: 'Text alignment' })).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Align text left',
      'Align text center',
      'Align text right',
    ])
    await user.click(screen.getByRole('menuitem', { name: 'Align text right' }))
    expect(state.board.blocks.bt).toEqual({ type: 'text', markdown: 'Hello', align: 'right' })
    const sb = state.board.nodes.s.blockId!
    expect(state.board.blocks[sb]).toEqual({ type: 'text', markdown: '', align: 'right' })
  })

  test('flip, order, duplicate and wrap call the store actions', async () => {
    const user = userEvent.setup()
    const { actions } = setup(B, ['s'])
    await user.click(screen.getByRole('button', { name: 'Flip' }))
    await user.click(screen.getByRole('menuitem', { name: 'Flip vertical' }))
    expect(actions.flip).toHaveBeenCalledWith('y', ['s'])
    await user.click(screen.getByRole('button', { name: ORDER_LABEL }))
    expect(within(screen.getByRole('menu', { name: ORDER_LABEL })).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Bring to front',
      'Bring forward',
      'Send backward',
      'Send to back',
    ])
    await user.click(screen.getByRole('menuitem', { name: 'Send to back' }))
    expect(actions.order).toHaveBeenCalledWith('back', ['s'])
    await user.click(screen.getByRole('button', { name: 'Duplicate' }))
    expect(actions.duplicate).toHaveBeenCalledWith(['s'])
    await user.click(screen.getByRole('button', { name: 'Wrap in new frame' }))
    expect(actions.wrapInFrame).toHaveBeenCalledWith(['s'])
  })

  test('nothing selected renders nothing', () => {
    const { actions } = fakeActions(B)
    const { container } = render(<SelectionToolbar nodes={[]} edges={[]} blocks={{}} actions={actions} />)
    expect(container).toBeEmptyDOMElement()
  })
})
