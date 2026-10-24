import { describe, expect, test } from 'vitest'
import { chipStyle } from '@/shell/typeColor'
import { colorName, labelStyle, lineColor, tagStyle, themeColor, THEME_COLORS } from './palette'

describe('palette', () => {
  test('test palette has 18 colours in order and sky is "Light blue"', () => {
    expect(THEME_COLORS).toEqual([
      'gray', 'rose', 'pink', 'fuchsia', 'purple', 'violet', 'indigo', 'blue', 'sky',
      'cyan', 'teal', 'emerald', 'green', 'lime', 'yellow', 'amber', 'orange', 'red',
    ])
    expect(colorName('sky')).toBe('Light blue')
    expect(colorName('emerald')).toBe('Emerald')
    expect(colorName('gray')).toBe('Gray')
    for (const c of THEME_COLORS) {
      const chip = chipStyle(c) as Record<string, string>
      expect(chip['--chip-fg']).toBe(`var(--type-${c}-fg)`)
      expect(chip['--chip-bg']).toBe(`var(--type-${c}-bg)`)
    }
  })

  test('test unknown colour falls back to gray', () => {
    expect(themeColor('chartreuse')).toBe('gray')
    expect(themeColor(null)).toBe('gray')
    expect(themeColor(undefined)).toBe('gray')
    expect(themeColor('bg-teal')).toBe('teal') // tag objects store `bg-<c>`
    expect(colorName('chartreuse')).toBe('Gray')
    expect((chipStyle('chartreuse') as Record<string, string>)['--chip-bg']).toBe('var(--type-gray-bg)')
    expect(tagStyle('nope')).toEqual({ backgroundColor: 'var(--tag-bg-gray)', color: 'var(--tag-text-gray)' })
    expect(tagStyle('bg-rose')).toEqual({ backgroundColor: 'var(--tag-bg-rose)', color: 'var(--tag-text-rose)' })
    expect(labelStyle('sky')).toEqual({
      backgroundColor: 'var(--type-sky-bg)',
      borderColor: 'var(--label-border-sky)',
      color: 'var(--type-sky-fg)',
    })
    expect(lineColor('nope')).toBe('var(--line-gray)')
    expect(lineColor('red')).toBe('var(--line-red)')
  })
})
