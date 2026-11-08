import { describe, expect, test } from 'vitest'
import { COLOR_VALUES, DEFAULT_RING, borderStyle, borderValue, edgeColorStyle, fillStyle, fillValue, isDarkMode } from './colors'
import { THEME_COLORS } from '@/theme/palette'
import { TAILWIND, mixHex } from '@/theme/tailwindPalette'

describe('whiteboard colours', () => {
  test('test every colour follows the palette rule', () => {
    expect(Object.keys(COLOR_VALUES)).toEqual([...THEME_COLORS])
    for (const c of THEME_COLORS) {
      const h = TAILWIND[c === 'gray' ? 'stone' : c]
      expect(COLOR_VALUES[c], c).toEqual({
        bgLight: h[50],
        borderLight: h[300],
        bgDark: mixHex(h[900], TAILWIND.zinc[900], 0.4),
        borderDark: h[400],
      })
    }
  })

  test('test fill and border colours', () => {
    expect(fillValue('bg-blue', true)).toBe('#1a2647')
    expect(fillValue('bg-blue', false)).toBe('#eff6ff')
    expect(borderValue('red', true)).toBe('#f87171')
    expect(borderValue('red', false)).toBe('#fca5a5')
    expect(fillValue(undefined)).toBeNull()
    expect(fillValue('bg-bogus')).toBeNull()
    expect(borderValue('bogus')).toBeNull()

    expect(fillStyle('bg-yellow', true)).toEqual({ backgroundColor: '#3c2817', fill: '#3c2817' })
    expect(fillStyle(undefined)).toEqual({})
    expect(borderStyle('orange', true)).toEqual({ '--whiteboard-node-color-ring': '#fb923c', borderColor: '#fb923c', stroke: '#fb923c' })
    expect(borderStyle(undefined)).toEqual({})
    expect(edgeColorStyle('blue', true)).toEqual({ '--whiteboard-edge-color': '#60a5fa' })
    expect(DEFAULT_RING).toBe('var(--color-border-base)')
  })

  test('test dark mode follows the html class', () => {
    const root = document.documentElement
    root.classList.add('dark')
    expect(isDarkMode()).toBe(true)
    expect(fillValue('bg-green')).toBe('#163022')
    root.classList.remove('dark')
    expect(isDarkMode()).toBe(false)
    expect(fillValue('bg-green')).toBe('#f0fdf4')
  })
})
