import { describe, expect, it } from 'vitest'
import type { NumberFormat } from '@/api/types'
import { propertyDef } from '@/test/mockApi'
import { CURRENCIES } from './currencies'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import {
  formatDate,
  formatNumber,
  parseNumberInput,
  placeholderFor,
  progressFraction,
  propertyIsEmpty,
} from './format'

const fmt = (type: NumberFormat['type'], options: NumberFormat['options'] = {}): NumberFormat => ({ type, options })

describe('formatNumber', () => {
  it('test currency EUR 2 decimals → "€1,234.50"', () => {
    expect(formatNumber(1234.5, fmt('currency', { currency: 'EUR', decimals: { min: 2, max: 2 } }))).toBe('€1,234.50')
  })

  it('test percentage 0.25 → "25%"', () => {
    expect(formatNumber(0.25, fmt('percentage'))).toBe('25%')
  })

  it('test grouping on by default', () => {
    expect(formatNumber(1234.5, fmt('number'))).toBe('1,234.5')
  })

  it('test grouping off → "1234.5"', () => {
    expect(formatNumber(1234.5, fmt('number', { separators: { isGroupingThousands: false } }))).toBe('1234.5')
  })

  it('test radix comma → "1.234,5"', () => {
    expect(formatNumber(1234.5, fmt('number', { separators: { isRadixComma: true } }))).toBe('1.234,5')
    expect(
      formatNumber(1234.5, fmt('number', { separators: { isRadixComma: true, isGroupingThousands: false } })),
    ).toBe('1234,5')
  })

  it('test no format and null', () => {
    expect(formatNumber(1234.5)).toBe('1234.5')
    expect(formatNumber(null)).toBe('')
  })
})

describe('progressFraction', () => {
  it('test progress fraction 4 of 10 steps is 0.4 and clamps to [0,1]', () => {
    const p = fmt('progress', { progress: { steps: 10, color: 'blue' } })
    expect(progressFraction(4, p)).toBeCloseTo(0.4)
    expect(progressFraction(14, p)).toBe(1)
    expect(progressFraction(-2, p)).toBe(0)
    expect(progressFraction(null, p)).toBe(0)
  })
})

describe('parseNumberInput', () => {
  it('test parseNumberInput', () => {
    expect(parseNumberInput('')).toBeNull()
    expect(parseNumberInput('   ')).toBeNull()
    expect(parseNumberInput('abc')).toBeUndefined()
    expect(parseNumberInput('42')).toBe(42)
    expect(parseNumberInput('-3.5')).toBe(-3.5)
    expect(parseNumberInput('1,234.5')).toBe(1234.5)
    expect(parseNumberInput('1.234,5', fmt('number', { separators: { isRadixComma: true } }))).toBe(1234.5)
    expect(parseNumberInput('0,25', fmt('number', { separators: { isRadixComma: true } }))).toBe(0.25)
  })
})

describe('formatDate', () => {
  it('test formatDate day, time, range with " → "', () => {
    expect(formatDate({ start: '2026-10-30', resolution: 'day' })).toBe('Oct 30, 2026')
    expect(formatDate({ start: '2026-10-30', end: '2026-11-02', resolution: 'day' })).toBe(
      'Oct 30, 2026 → Nov 2, 2026',
    )
    const t = '2026-10-30T14:00:00.000Z'
    const local = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(t))
    expect(formatDate({ start: t, resolution: 'time' })).toBe(local)
    const t2 = '2026-10-30T15:30:00.000Z'
    const local2 = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(t2))
    expect(formatDate({ start: t, end: t2, resolution: 'time' })).toBe(`${local} → ${local2}`)
    expect(formatDate(null)).toBe('')
  })

  it('test date and time formats follow settings; localized output unchanged', () => {
    const t = '2026-10-30T14:05:00.000Z'
    const d = new Date(t)
    const local = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
    const pad = (n: number) => String(n).padStart(2, '0')
    const hh = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    try {
      // Localized (the default) keeps today's output byte for byte.
      useSettings.setState({ settings: settingsDefaults })
      expect(formatDate({ start: '2026-10-30', resolution: 'day' })).toBe('Oct 30, 2026')
      expect(formatDate({ start: t, resolution: 'time' })).toBe(local)

      // 24-hour time changes only the time.
      useSettings.setState({ settings: { ...settingsDefaults, twentyFourHourTime: true } })
      expect(formatDate({ start: '2026-10-30', resolution: 'day' })).toBe('Oct 30, 2026')
      const local24 = formatDate({ start: t, resolution: 'time' })
      expect(local24).toContain(hh)
      expect(local24).not.toMatch(/AM|PM/)

      // Numeric orders, by the option labels' separators.
      useSettings.setState({ settings: { ...settingsDefaults, dateFormatting: 'DMY' } })
      expect(formatDate({ start: '2026-10-03', resolution: 'day' })).toBe('03-10-2026')
      useSettings.setState({ settings: { ...settingsDefaults, dateFormatting: 'MDY' } })
      expect(formatDate({ start: '2026-10-03', end: '2026-11-02', resolution: 'day' })).toBe('10/03/2026 → 11/02/2026')
      useSettings.setState({ settings: { ...settingsDefaults, dateFormatting: 'YMD', twentyFourHourTime: true } })
      expect(formatDate({ start: '2026-10-03', resolution: 'day' })).toBe('2026-10-03')
      const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      expect(formatDate({ start: t, resolution: 'time' })).toBe(`${ymd}, ${hh}`)
    } finally {
      useSettings.setState({ settings: settingsDefaults })
    }
  })
})

describe('propertyIsEmpty', () => {
  it('test propertyIsEmpty quirks: number 0, boolean false, label [] empty; createdAt always empty', () => {
    expect(propertyIsEmpty(propertyDef({ id: 'n', type: 'number' }), 0)).toBe(true)
    expect(propertyIsEmpty(propertyDef({ id: 'n', type: 'number' }), 3)).toBe(false)
    expect(propertyIsEmpty(propertyDef({ id: 'b', type: 'boolean' }), false)).toBe(true)
    expect(propertyIsEmpty(propertyDef({ id: 'b', type: 'boolean' }), true)).toBe(false)
    expect(propertyIsEmpty(propertyDef({ id: 'l', type: 'label' }), [])).toBe(true)
    expect(propertyIsEmpty(propertyDef({ id: 'l', type: 'label' }), ['A'])).toBe(false)
    expect(propertyIsEmpty(propertyDef({ id: 'createdAt', type: 'entity_createdAt' }), '2026-01-01')).toBe(true)
    expect(propertyIsEmpty(propertyDef({ id: 'lastUpdated', type: 'entity_lastUpdated' }), '2026-01-01')).toBe(true)
    expect(propertyIsEmpty(propertyDef({ id: 't', type: 'text' }), '')).toBe(true)
    expect(propertyIsEmpty(propertyDef({ id: 't', type: 'text' }), null)).toBe(true)
    expect(propertyIsEmpty(propertyDef({ id: 't', type: 'text' }), 'x')).toBe(false)
    expect(propertyIsEmpty(propertyDef({ id: 'e', type: 'entity' }), [])).toBe(true)
    expect(propertyIsEmpty(propertyDef({ id: 'd', type: 'datetime' }), null)).toBe(true)
    expect(
      propertyIsEmpty(propertyDef({ id: 'd', type: 'datetime' }), { start: '2026-01-01', resolution: 'day' }),
    ).toBe(false)
  })
})

describe('placeholderFor', () => {
  it('test placeholder is the description, else "Empty"', () => {
    expect(placeholderFor(propertyDef({ id: 'a' }))).toBe('Empty')
    expect(placeholderFor(propertyDef({ id: 'a', description: 'Who owns it' }))).toBe('Who owns it')
  })

  it('test an empty table cell is blank', () => {
    expect(placeholderFor(propertyDef({ id: 'a', description: 'Who owns it' }), 'table')).toBe('')
    expect(placeholderFor(propertyDef({ id: 'a' }), 'panel')).toBe('Empty')
  })
})

describe('CURRENCIES', () => {
  it('test currencies start in the bundle order and are unique', () => {
    expect(CURRENCIES.slice(0, 5).map((c) => c.code)).toEqual(['EUR', 'USD', 'GBP', 'CNY', 'JPY'])
    expect(CURRENCIES[0]).toEqual({ code: 'EUR', name: 'Euro', symbol: '€' })
    const codes = CURRENCIES.map((c) => c.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes.filter((c) => c === 'TWD')).toHaveLength(1)
    expect(codes.filter((c) => c === 'XAF')).toHaveLength(1)
  })
})
