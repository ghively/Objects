import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { InkToolbar } from './InkToolbar'
import { DEFAULT_INK, INK_COLORS } from './inkModel'
import { INK_STRINGS } from './inkStrings'
import type { InkToolState } from './types'

describe('InkToolbar', () => {
  test('toolbar toggles tools, colours and widths; clicking the active tool turns ink off', () => {
    const onChange = vi.fn()
    const { rerender } = render(<InkToolbar value={null} readOnly={false} onChange={onChange} />)
    const pen = screen.getByRole('button', { name: 'Pen' })
    expect(pen).toHaveAttribute('title', 'Pen (P)')
    expect(screen.getByRole('button', { name: 'Highlighter' })).toHaveAttribute('title', 'Highlighter (M)')
    expect(screen.getByRole('button', { name: 'Eraser' })).toHaveAttribute('title', 'Eraser (E)')
    // No colour or width row while ink is off.
    expect(screen.queryByRole('radiogroup')).toBeNull()

    fireEvent.click(pen)
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_INK)

    rerender(<InkToolbar value={DEFAULT_INK} readOnly={false} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Pen' })).toHaveAttribute('aria-pressed', 'true')
    const colours = screen.getByRole('radiogroup', { name: INK_STRINGS.inkColour })
    expect(colours.querySelectorAll('[role="radio"]')).toHaveLength(18)
    const widths = screen.getByRole('radiogroup', { name: INK_STRINGS.width })
    expect([...widths.querySelectorAll('[data-width]')].map((b) => b.getAttribute('data-width'))).toEqual(['2', '4', '8'])

    const blue = INK_COLORS.find((c) => c.name === 'blue')!
    fireEvent.click(screen.getByRole('radio', { name: 'Blue' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_INK, color: blue.hex })
    fireEvent.click(screen.getByRole('radio', { name: 'Width 8' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_INK, width: 8 })

    // Switching to the highlighter keeps the colour and takes its default width.
    const blueInk: InkToolState = { ...DEFAULT_INK, color: blue.hex }
    rerender(<InkToolbar value={blueInk} readOnly={false} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Highlighter' }))
    expect(onChange).toHaveBeenLastCalledWith({ tool: 'highlighter', color: blue.hex, width: 16 })
    rerender(<InkToolbar value={{ tool: 'highlighter', color: blue.hex, width: 16 }} readOnly={false} onChange={onChange} />)
    const hlWidths = screen.getByRole('radiogroup', { name: INK_STRINGS.width })
    expect([...hlWidths.querySelectorAll('[data-width]')].map((b) => b.getAttribute('data-width'))).toEqual(['16', '32'])

    // The eraser shows no colour or width row.
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ tool: 'eraser' }))
    rerender(<InkToolbar value={{ tool: 'eraser', color: blue.hex, width: 4 }} readOnly={false} onChange={onChange} />)
    expect(screen.queryByRole('radiogroup')).toBeNull()

    // Clicking the active tool turns ink off.
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  test('toolbar disabled with the read-only tooltip', () => {
    const onChange = vi.fn()
    render(<InkToolbar value={DEFAULT_INK} readOnly onChange={onChange} />)
    for (const name of ['Pen', 'Highlighter', 'Eraser']) {
      const b = screen.getByRole('button', { name })
      expect(b).toBeDisabled()
      expect(b).toHaveAttribute('title', "This ink file has content Object didn't write, so it opens read-only.")
      fireEvent.click(b)
    }
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })
})
