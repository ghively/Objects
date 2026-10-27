import { describe, expect, test } from 'vitest'
import { snapToNodes } from './snapGuides'

describe('snapToNodes', () => {
  test('snap to nodes aligns edges and centres within threshold', () => {
    const other = { x: 100, y: 100, width: 100, height: 50 }
    // left edge 4 units right of the other's left edge; top 3 below its top
    const left = snapToNodes({ x: 104, y: 303, width: 60, height: 40 }, [other])
    expect(left.dx).toBe(-4)
    expect(left.guides.some((g) => g.orientation === 'vertical' && g.position === 100)).toBe(true)
    expect(left.dy).toBe(0) // 303 is far from 100/125/150

    // centre on centre: moving centre x = 147 + 5 = 152 → other's 150
    const centre = snapToNodes({ x: 147, y: 120, width: 10, height: 10 }, [other])
    expect(centre.dx).toBe(-2)
    expect(centre.dy).toBe(0) // centre y already 125 = other's middle
    const v = centre.guides.find((g) => g.orientation === 'vertical')!
    expect(v.position).toBe(150)
    expect(v.start).toBe(100)
    expect(v.end).toBe(150)
    expect(centre.guides.some((g) => g.orientation === 'horizontal' && g.position === 125)).toBe(true)

    // right edge onto right edge, bottom onto bottom
    const corner = snapToNodes({ x: 145, y: 104, width: 50, height: 50 }, [other])
    expect(corner.dx).toBe(5)
    expect(corner.dy).toBe(-4)
  })

  test('outside the threshold nothing moves and no guide is drawn', () => {
    const r = snapToNodes({ x: 107, y: 407, width: 10, height: 10 }, [{ x: 100, y: 100, width: 100, height: 100 }])
    expect(r).toEqual({ dx: 0, dy: 0, guides: [] })
    const custom = snapToNodes({ x: 110, y: 400, width: 10, height: 10 }, [{ x: 100, y: 0, width: 5, height: 5 }], 12)
    expect(custom.dx).toBe(-5) // right edge 120 is 15 away, left 110 onto the other's right 105
  })

  test('the closest candidate wins across several nodes', () => {
    const r = snapToNodes({ x: 203, y: 0, width: 10, height: 10 }, [
      { x: 205, y: 500, width: 10, height: 10 }, // 2 away
      { x: 199, y: 600, width: 10, height: 10 }, // 1 away
    ])
    expect(r.dx).toBe(1)
  })
})
