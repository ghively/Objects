import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { COLOR_VALUES, DEFAULT_RING, borderStyle, borderValue, edgeColorStyle, fillStyle, fillValue, isDarkMode } from './colors'
import { THEME_COLORS } from '@/theme/palette'

const THEMES = readFileSync(
  path.resolve(import.meta.dirname, '../../../reference/recovered-ts/src/shared-logic/util/colorThemes.ts'),
  'utf8',
)

describe('whiteboard colours', () => {
  test('test fill and border colours from the reference values', () => {
    expect(Object.keys(COLOR_VALUES)).toEqual([...THEME_COLORS])
    for (const [name, v] of Object.entries(COLOR_VALUES)) {
      const block = new RegExp(`\\n  ${name}: \\{([^}]*)\\}`).exec(THEMES)?.[1] ?? ''
      for (const key of ['bgLight', 'borderLight', 'bgDark', 'borderDark'] as const) {
        expect(block, `${name}.${key}`).toContain(`${key}: '${v[key]}'`)
      }
    }
    expect(fillValue('bg-blue', true)).toBe('#263956')
    expect(fillValue('bg-blue', false)).toBe('#E4EFFE')
    expect(borderValue('red', true)).toBe('#F87171')
    expect(borderValue('red', false)).toBe('#FDA5A5')
    expect(fillValue(undefined)).toBeNull()
    expect(fillValue('bg-bogus')).toBeNull()
    expect(borderValue('bogus')).toBeNull()

    expect(fillStyle('bg-yellow', true)).toEqual({ backgroundColor: '#48422E', fill: '#48422E' })
    expect(fillStyle(undefined)).toEqual({})
    expect(borderStyle('orange', true)).toEqual({ '--whiteboard-node-color-ring': '#FB923C', borderColor: '#FB923C', stroke: '#FB923C' })
    expect(borderStyle(undefined)).toEqual({})
    expect(edgeColorStyle('blue', true)).toEqual({ '--whiteboard-edge-color': '#60A5FB' })
    expect(DEFAULT_RING).toBe('var(--color-border-base)')
  })

  test('test dark mode follows the html class', () => {
    const root = document.documentElement
    root.classList.add('dark')
    expect(isDarkMode()).toBe(true)
    expect(fillValue('bg-green')).toBe('#254638')
    root.classList.remove('dark')
    expect(isDarkMode()).toBe(false)
    expect(fillValue('bg-green')).toBe('#E4FDED')
  })
})
