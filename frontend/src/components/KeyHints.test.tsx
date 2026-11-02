import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { KeyHints } from './KeyHints'

describe('<KeyHints>', () => {
  test("shows Capacities' footer: navigate, abort, select", () => {
    render(<KeyHints />)
    const bar = screen.getByRole('note', { name: 'Keyboard hints' })
    expect(bar).toHaveTextContent('↑↓ to navigate')
    expect(bar).toHaveTextContent('Esc to abort')
    expect(bar).toHaveTextContent('↵ to select')
  })

  test('adds extra hints after the three (the search palette: new tab, side panel)', () => {
    render(<KeyHints extra={[{ keys: 'Ctrl ↵', label: 'in new tab' }, { keys: 'Shift ↵', label: 'in side panel' }]} />)
    const bar = screen.getByRole('note', { name: 'Keyboard hints' })
    expect(bar).toHaveTextContent('Ctrl ↵ in new tab')
    expect(bar).toHaveTextContent('Shift ↵ in side panel')
  })
})
