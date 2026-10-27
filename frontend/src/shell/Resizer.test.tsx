import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Resizer } from './Resizer'

function pointer(el: Element, type: string, x: number, y: number, button = 0) {
  fireEvent(el, new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button, pointerId: 1 }))
}

describe('Resizer', () => {
  test('test reports the distance while dragging and once on pointer up (x)', () => {
    const onDrag = vi.fn()
    const onEnd = vi.fn()
    render(<Resizer direction="x" label="Resize" onDrag={onDrag} onEnd={onEnd} />)
    const bar = screen.getByRole('separator', { name: 'Resize' })
    expect(bar).toHaveAttribute('aria-orientation', 'vertical')
    pointer(bar, 'pointermove', 50, 0) // not pressed: ignored
    expect(onDrag).not.toHaveBeenCalled()
    pointer(bar, 'pointerdown', 100, 10)
    pointer(bar, 'pointermove', 80, 40)
    pointer(bar, 'pointermove', 60, 90)
    expect(onDrag.mock.calls.map((c) => c[0])).toEqual([-20, -40])
    expect(onEnd).not.toHaveBeenCalled()
    pointer(bar, 'pointerup', 55, 90)
    expect(onEnd).toHaveBeenCalledWith(-45)
    pointer(bar, 'pointermove', 10, 0)
    expect(onDrag).toHaveBeenCalledTimes(2)
  })

  test('test y direction uses the vertical distance; other buttons do nothing', () => {
    const onDrag = vi.fn()
    const onEnd = vi.fn()
    render(<Resizer direction="y" label="Resize area" onDrag={onDrag} onEnd={onEnd} />)
    const bar = screen.getByRole('separator', { name: 'Resize area' })
    expect(bar).toHaveAttribute('aria-orientation', 'horizontal')
    pointer(bar, 'pointerdown', 0, 0, 2)
    pointer(bar, 'pointermove', 0, 30)
    expect(onDrag).not.toHaveBeenCalled()
    pointer(bar, 'pointerdown', 5, 100)
    pointer(bar, 'pointermove', 50, 130)
    pointer(bar, 'pointerup', 50, 150)
    expect(onDrag).toHaveBeenCalledWith(30)
    expect(onEnd).toHaveBeenCalledWith(50)
  })
})
