import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { GatesMenu } from './GatesMenu'

test('test gates menu lists the gates then I/O', async () => {
  const onPick = vi.fn()
  render(<GatesMenu onPick={onPick} />)
  const menu = screen.getByRole('menu', { name: 'Gates' })
  const items = within(menu).getAllByRole('menuitem')
  expect(items.map((i) => i.textContent?.replace(/^.{2}/, ''))).toEqual(['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR', 'HIGH', 'LOW'])
  const text = menu.textContent ?? ''
  expect(text.indexOf('I/O')).toBeGreaterThan(text.indexOf('XNOR'))
  expect(text.indexOf('I/O')).toBeLessThan(text.indexOf('HIGH'))
  await userEvent.setup().click(screen.getByRole('menuitem', { name: /NAND/ }))
  expect(onPick).toHaveBeenCalledWith('nand')
})
