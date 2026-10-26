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
      backgroundColor: 'var(--label-bg-sky)',
      borderColor: 'var(--label-border-sky)',
      color: 'var(--label-text-sky)',
    })
    expect(lineColor('nope')).toBe('var(--line-gray)')
  })

  test('every colour defines its type chip and label pill tokens', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(`${process.cwd()}/src/theme/tokens.css`, 'utf8')
    for (const c of THEME_COLORS) {
      for (const token of [`--type-${c}-fg`, `--type-${c}-bg`, `--label-bg-${c}`, `--label-text-${c}`, `--label-border-${c}`]) {
        expect(css.match(new RegExp(`${token}:`, 'g'))?.length, token).toBe(1)
      }
    }
    expect(css).toMatch(/--label-bg-blue: #334069;/)
    expect(css).toMatch(/--label-text-blue: #4f93f3;/)
    expect(css).toMatch(/--label-bg-gray: #28282b;/)
    expect(css).toMatch(/--label-text-gray: #7b7776;/)
    expect(lineColor('red')).toBe('var(--line-red)')
  })
})
