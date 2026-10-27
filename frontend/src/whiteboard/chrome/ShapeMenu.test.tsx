import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ShapeMenu } from './ShapeMenu'

test('test shape menu order and picker set', async () => {
  const onPick = vi.fn()
  render(<ShapeMenu value="ellipse" onPick={onPick} />)
  const items = within(screen.getByRole('menu', { name: 'Shapes' })).getAllByRole('menuitem')
  expect(items.map((i) => i.textContent)).toEqual([
    'Line',
    'Arrow',
    'Rectangle',
    'Ellipse',
    'Diamond',
    'Parallelogram',
    'Triangle',
    'Star',
    'Bubble',
    'Arrow right',
    'Heart',
  ])
  expect(items).toHaveLength(11)
  expect(screen.queryByText('Rounded rectangle')).toBeNull()
  expect(items[3]).toHaveAttribute('aria-current', 'true')
  expect(items[2]).toHaveAttribute('title', 'Rectangle (R)')
  // Every row has a drawing.
  for (const item of items) expect(item.querySelector('svg')).not.toBeNull()
  await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Arrow right' }))
  expect(onPick).toHaveBeenCalledWith('blockArrow')
})
