// M8 Task 7: the language, decimal separator and time zone in property formatting.
import { fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { DeviceSettings, NumberFormat } from '@/api/types'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { propertyDef } from '@/test/mockApi'
import { NumberCell } from './cells/NumberCell'
import { formatDate, formatNumber, parseNumberInput } from './format'

function settings(p: Partial<DeviceSettings>) {
  useSettings.setState({ settings: { ...settingsDefaults, ...p } })
}

afterEach(() => {
  useSettings.setState({ settings: settingsDefaults })
})

const NUM: NumberFormat = { type: 'number', options: {} }

describe('format (M8 settings)', () => {
  test('test decimal separator formats and parses numbers', () => {
    // Automatic follows the language.
    settings({})
    expect(formatNumber(1234.5, NUM)).toBe('1,234.5')
    expect(formatNumber(1.5)).toBe('1.5')
    expect(parseNumberInput('1,234.5', NUM)).toBe(1234.5)
    settings({ language: 'de' })
    expect(formatNumber(1234.5, NUM)).toBe('1.234,5')
    expect(formatNumber(1.5)).toBe('1,5')
    expect(parseNumberInput('1.234,5', NUM)).toBe(1234.5)
    settings({ language: 'en-gb' })
    expect(formatNumber(1234.5, NUM)).toBe('1,234.5')

    // An explicit choice wins over the language.
    settings({ language: 'de', decimalSeparator: 'dot' })
    expect(formatNumber(1234.5, NUM)).toBe('1,234.5')
    expect(parseNumberInput('2.5')).toBe(2.5)
    settings({ language: 'en', decimalSeparator: 'comma' })
    expect(formatNumber(1234.5, NUM)).toBe('1.234,5')
    expect(formatNumber(0.25, { type: 'percentage', options: {} })).toBe('25%')
    expect(formatNumber(1234.5, { type: 'currency', options: { currency: 'EUR', decimals: { min: 2, max: 2 } } })).toBe(
      '€1.234,50',
    )
    expect(parseNumberInput('2,5')).toBe(2.5)
    expect(parseNumberInput('1.234,5')).toBe(1234.5)

    // The property's own "Separator comma" still turns the comma on.
    settings({ decimalSeparator: 'dot' })
    expect(formatNumber(1234.5, { type: 'number', options: { separators: { isRadixComma: true } } })).toBe('1.234,5')
  })

  test('test number cell parses with the separator', () => {
    vi.useFakeTimers()
    try {
      settings({ decimalSeparator: 'comma' })
      const onChange = vi.fn()
      const def = propertyDef({ id: 'n', name: 'Amount', type: 'number', options: { numberFormat: NUM } })
      render(<NumberCell def={def} value={1234.5} onChange={onChange} />)
      const input = screen.getByRole('textbox', { name: 'Amount' })
      expect(input).toHaveValue('1.234,5')
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: '2,75' } })
      fireEvent.blur(input)
      expect(onChange).toHaveBeenLastCalledWith(2.75)
      // A change of the setting re-renders the shown number.
      act(() => settings({ decimalSeparator: 'dot' }))
      expect(input).toHaveValue('1,234.5')
    } finally {
      vi.useRealTimers()
    }
  })

  test('test localized dates follow the language', () => {
    settings({ language: 'de' })
    expect(formatDate({ start: '2026-10-30', resolution: 'day' })).toBe(
      new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 9, 30))),
    )
    expect(formatDate({ start: '2026-10-30', resolution: 'day' })).toBe('30.10.2026')
    settings({ language: 'en-gb' })
    expect(formatDate({ start: '2026-10-30', resolution: 'day' })).toBe('30 Oct 2026')
    settings({ language: 'en' })
    expect(formatDate({ start: '2026-10-30', resolution: 'day' })).toBe('Oct 30, 2026')
    // A numeric order ignores the language; the stored value is never touched.
    settings({ language: 'de', dateFormatting: 'YMD' })
    expect(formatDate({ start: '2026-10-30', resolution: 'day' })).toBe('2026-10-30')
  })

  test('test instants show in the time zone setting', () => {
    const t = '2026-10-30T23:30:00.000Z'
    settings({ timeZone: 'Asia/Tokyo', twentyFourHourTime: true, dateFormatting: 'YMD' })
    expect(formatDate({ start: t, resolution: 'time' })).toBe('2026-10-31, 08:30')
    settings({ timeZone: 'America/New_York', twentyFourHourTime: true, dateFormatting: 'YMD' })
    expect(formatDate({ start: t, resolution: 'time' })).toBe('2026-10-30, 19:30')
    settings({ timeZone: 'Europe/Berlin', language: 'de', twentyFourHourTime: true })
    expect(formatDate({ start: t, resolution: 'time' })).toBe('31.10.2026, 00:30')
    // A day is never shifted by the zone.
    settings({ timeZone: 'Pacific/Kiritimati' })
    expect(formatDate({ start: '2026-10-30', resolution: 'day' })).toBe('Oct 30, 2026')
  })
})
