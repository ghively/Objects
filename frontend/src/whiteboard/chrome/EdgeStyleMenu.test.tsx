import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import type { WhiteboardData } from '@/api/whiteboardTypes'
import { board, edge, node, textBlock } from '../test/boards'
import { fakeActions } from './fakeActions'
import { SelectionToolbar } from './SelectionToolbar'

const a = node({ id: 'a', kind: 'shape', shape: 'rectangle', position: { x: 0, y: 0 }, width: 90, height: 90 })
const b = node({ id: 'b', kind: 'shape', shape: 'rectangle', position: { x: 300, y: 0 }, width: 90, height: 90 })
const e1 = edge({ id: 'e1', source: 'a', target: 'b', markerEnd: 'arrowClosed' })
const e2 = edge({ id: 'e2', source: 'b', target: 'a', blockId: 'lb' })
const B: WhiteboardData = board([a, b], [e1, e2], { lb: textBlock('label') })

function setup(ids: string[]) {
  const { actions, state } = fakeActions(B)
  render(<SelectionToolbar nodes={[]} edges={ids.map((id) => B.edges[id])} blocks={B.blocks} actions={actions} />)
  return { actions, state }
}

test('test edge style menu writes tips, connection, line and colour and remembers the style', async () => {
  const user = userEvent.setup()
  const { actions, state } = setup(['e1'])
  const names = within(screen.getByRole('toolbar'))
    .getAllByRole('button')
    .map((x) => x.getAttribute('aria-label'))
  expect(names).toEqual(['Start tip', 'End tip', 'Connection', 'Line', 'Color', 'Add arrow label', 'Delete'])

  // End tip: arrowClosed shows as Arrow.
  await user.click(screen.getByRole('button', { name: 'End tip' }))
  const tips = within(screen.getByRole('menu', { name: 'End tip' })).getAllByRole('menuitem')
  expect(tips.map((t) => t.textContent)).toEqual(['None', 'Arrow', 'Dot', 'Double arrow'])
  expect(tips[1]).toHaveAttribute('aria-current', 'true')
  await user.click(screen.getByRole('menuitem', { name: 'Double arrow' }))
  expect(state.board.edges.e1.markerEnd).toBe('double')

  await user.click(screen.getByRole('button', { name: 'Start tip' }))
  await user.click(screen.getByRole('menuitem', { name: 'Dot' }))
  expect(state.board.edges.e1.markerStart).toBe('dot')

  // Unset connection is Cornered; unset line is Solid.
  await user.click(screen.getByRole('button', { name: 'Connection' }))
  const conns = within(screen.getByRole('menu', { name: 'Connection' })).getAllByRole('menuitem')
  expect(conns.map((c) => c.textContent)).toEqual(['Straight', 'Cornered', 'Curved'])
  expect(conns[1]).toHaveAttribute('aria-current', 'true')
  await user.click(screen.getByRole('menuitem', { name: 'Curved' }))
  expect(state.board.edges.e1.connection).toBe('curved')
  expect(actions.remember).toHaveBeenCalledWith({ lastEdgeConnection: 'curved' })

  await user.click(screen.getByRole('button', { name: 'Line' }))
  const lines = within(screen.getByRole('menu', { name: 'Line' })).getAllByRole('menuitem')
  expect(lines.map((l) => l.textContent)).toEqual(['Solid', 'Dashed', 'Dotted'])
  expect(lines[0]).toHaveAttribute('aria-current', 'true')
  await user.click(screen.getByRole('menuitem', { name: 'Dotted' }))
  expect(state.board.edges.e1.line).toBe('dotted')
  expect(actions.remember).toHaveBeenCalledWith({ lastEdgeLine: 'dotted' })

  await user.click(screen.getByRole('button', { name: 'Color' }))
  await user.click(screen.getByRole('button', { name: 'Red' }))
  expect(state.board.edges.e1.color).toBe('red')

  // One undo step per change; other edges untouched.
  expect(actions.apply).toHaveBeenCalledTimes(5)
  expect(state.board.edges.e2).toEqual(B.edges.e2)
})

test('several edges are styled together', async () => {
  const user = userEvent.setup()
  const { actions, state } = setup(['e1', 'e2'])
  await user.click(screen.getByRole('button', { name: 'Line' }))
  // They agree on Solid (both unset).
  expect(screen.getByRole('menuitem', { name: 'Solid' })).toHaveAttribute('aria-current', 'true')
  await user.click(screen.getByRole('menuitem', { name: 'Dashed' }))
  expect(actions.apply).toHaveBeenCalledTimes(1)
  expect(state.board.edges.e1.line).toBe('dashed')
  expect(state.board.edges.e2.line).toBe('dashed')
})

test('add and remove arrow label', async () => {
  const user = userEvent.setup()
  const first = setup(['e1'])
  await user.click(screen.getByRole('button', { name: 'Add arrow label' }))
  const id = first.state.board.edges.e1.blockId!
  expect(first.state.board.blocks[id]).toEqual({ type: 'text', markdown: '' })
  expect(first.actions.beginEdit).toHaveBeenCalledWith('e1')
})

test('a labelled edge offers Remove arrow label', async () => {
  const user = userEvent.setup()
  const { state, actions } = setup(['e2'])
  await user.click(screen.getByRole('button', { name: 'Remove arrow label' }))
  expect(state.board.edges.e2.blockId).toBeUndefined()
  expect(state.board.blocks.lb).toBeUndefined()
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  expect(actions.removeSelection).toHaveBeenCalledWith(['e2'])
})
