import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { COLOR_VALUES } from '../colors'
import { edge } from '../test/boards'
import { markersInUse } from './connectorStyle'
import { MarkerDefs } from './Markers'

describe('MarkerDefs', () => {
  test('markers none, arrow, dot, double at start and end; arrowClosed renders as arrow', () => {
    const edges = [
      edge({ markerStart: 'dot', markerEnd: 'arrowClosed' }),
      edge({ markerStart: 'double', markerEnd: 'none' }),
      edge({}),
    ]
    const { container } = render(<MarkerDefs edges={edges} />)
    const ids = [...container.querySelectorAll('marker')].map((m) => m.id).sort()
    expect(ids).toEqual(
      [
        'wb-tip-arrow-default',
        'wb-tip-arrow-selected',
        'wb-tip-dot-default',
        'wb-tip-dot-selected',
        'wb-tip-double-default',
        'wb-tip-double-selected',
      ].sort(),
    )
    for (const m of container.querySelectorAll('marker')) {
      expect(m.getAttribute('orient')).toBe('auto-start-reverse')
      expect(m.getAttribute('markerUnits')).toBe('userSpaceOnUse')
    }
  })

  test('renders nothing without tips', () => {
    const { container } = render(<MarkerDefs edges={[edge(), edge({ markerEnd: 'none' })]} />)
    expect(container.querySelector('svg')).toBeNull()
  })

  test('edge colour applies to stroke and markers (one def per colour in use)', () => {
    document.documentElement.classList.add('dark')
    try {
      const edges = [
        edge({ color: 'blue', markerEnd: 'arrow' }),
        edge({ color: 'blue', markerStart: 'arrow' }),
        edge({ color: 'red', markerEnd: 'arrow' }),
      ]
      expect(markersInUse(edges)).toHaveLength(3) // blue, selected, red
      const { container } = render(<MarkerDefs edges={edges} />)
      const fill = (id: string) => (container.querySelector(`#${id} path`) as SVGPathElement).style.fill
      expect(fill('wb-tip-arrow-blue')).toBe(hexToRgb(COLOR_VALUES.blue.borderDark))
      expect(fill('wb-tip-arrow-red')).toBe(hexToRgb(COLOR_VALUES.red.borderDark))
      expect(fill('wb-tip-arrow-selected')).toBe('var(--color-border-block-selection)')
    } finally {
      document.documentElement.classList.remove('dark')
    }
  })
})

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}
