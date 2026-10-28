import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../model'
import { DisplayMenu } from './DisplayMenu'

test("test display menu switches call onSettings with Capacities' keys", async () => {
  const user = userEvent.setup()
  const onSettings = vi.fn()
  render(<DisplayMenu settings={{ ...DEFAULT_SETTINGS }} onSettings={onSettings} />)
  const switches = screen.getAllByRole('switch')
  expect(switches.map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true', 'true', 'false'])
  const cases: [string, string, boolean][] = [
    ['Snap to grid', 'isSnappingToGrid', false],
    ['Snap to nodes', 'isSnappingToNodes', false],
    ['Show dots', 'isShowingDots', false],
    ['Zoom with scroll wheel', 'isZoomingOnScroll', false],
    ['Engineering mode', 'isEngineeringMode', true],
  ]
  for (const [name, key, value] of cases) {
    await user.click(screen.getByRole('switch', { name }))
    expect(onSettings).toHaveBeenLastCalledWith(key, value)
  }
  expect(onSettings).toHaveBeenCalledTimes(5)
})
