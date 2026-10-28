import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ZoomMenu } from './ZoomMenu'

test('test zoom menu presets and commands', async () => {
  const user = userEvent.setup()
  const onZoom = vi.fn()
  render(<ZoomMenu zoom={0.5} onZoom={onZoom} />)
  const open = () => user.click(screen.getByRole('button', { name: '50%' }))

  await open()
  const menu = screen.getByRole('menu', { name: 'Zoom' })
  const labels = within(menu)
    .getAllByRole('menuitem')
    .map((i) => i.querySelector('.flex-1')?.textContent)
  expect(labels).toEqual([
    'Zoom in',
    'Zoom out',
    'Zoom to fit',
    'Zoom to selection',
    'Zoom to 100%',
    '5%',
    '10%',
    '25%',
    '50%',
    '75%',
    '100%',
    '125%',
    '150%',
    '200%',
    '300%',
  ])
  expect(within(menu).getByRole('menuitem', { name: '50%' })).toHaveAttribute('aria-current', 'true')

  const cmds: [string | RegExp, unknown][] = [
    [/^Zoom in/, 'in'],
    [/^Zoom out/, 'out'],
    [/^Zoom to fit/, 'fit'],
    [/^Zoom to selection/, 'selection'],
    [/^Zoom to 100%/, 'reset'],
    ['200%', 2],
  ]
  for (const [name, cmd] of cmds) {
    if (!screen.queryByRole('menu', { name: 'Zoom' })) await open()
    await user.click(within(screen.getByRole('menu', { name: 'Zoom' })).getByRole('menuitem', { name }))
    expect(onZoom).toHaveBeenLastCalledWith(cmd)
  }
})

test('zoom buttons step and stop at the limits', async () => {
  const user = userEvent.setup()
  const onZoom = vi.fn()
  const { rerender } = render(<ZoomMenu zoom={1} onZoom={onZoom} />)
  await user.click(screen.getByRole('button', { name: 'Zoom in' }))
  await user.click(screen.getByRole('button', { name: 'Zoom out' }))
  expect(onZoom.mock.calls).toEqual([['in'], ['out']])
  rerender(<ZoomMenu zoom={4} onZoom={onZoom} />)
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
  rerender(<ZoomMenu zoom={0.02} onZoom={onZoom} />)
  expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '2%' })).toBeInTheDocument()
})
