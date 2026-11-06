import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ConfidenceMeter } from './ConfidenceMeter'

describe('ConfidenceMeter', () => {
  test('three segments, filled by the confidence', () => {
    const { rerender, container } = render(<ConfidenceMeter confidence="Medium" reason="Seen twice on tray 2" />)
    expect(container.querySelectorAll('[data-segment]')).toHaveLength(3)
    expect(screen.getByRole('meter', { name: 'Confidence' })).toHaveAttribute('data-filled', '2')
    expect(screen.getByText('Seen twice on tray 2')).toBeInTheDocument()

    rerender(<ConfidenceMeter confidence="High" />)
    expect(screen.getByRole('meter')).toHaveAttribute('data-filled', '3')
    rerender(<ConfidenceMeter confidence="Low" />)
    expect(screen.getByRole('meter')).toHaveAttribute('data-filled', '1')
    rerender(<ConfidenceMeter confidence="N/A" />)
    expect(screen.getByRole('meter')).toHaveAttribute('data-filled', '0')
    rerender(<ConfidenceMeter confidence={null} />)
    expect(screen.getByRole('meter')).toHaveAttribute('data-filled', '0')
    expect(container.querySelectorAll('[data-segment]')).toHaveLength(3)
  })
})
