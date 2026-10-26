import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { arrowStep, useCalendar } from './useCalendar'

const set = (view: 'month' | 'week' | 'rolling' | 'day', anchor: string) => useCalendar.setState({ view, anchor })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 23, 10, 0))
  localStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useCalendar', () => {
  test('previous next step by view; today resets anchor', () => {
    const { previous, next, today } = useCalendar.getState()
    set('week', '2026-10-23')
    next()
    expect(useCalendar.getState().anchor).toBe('2026-10-30')
    previous()
    previous()
    expect(useCalendar.getState().anchor).toBe('2026-10-16')
    set('month', '2026-10-31')
    next()
    expect(useCalendar.getState().anchor).toBe('2026-11-30')
    set('month', '2026-10-23')
    previous()
    expect(useCalendar.getState().anchor).toBe('2026-09-23')
    set('rolling', '2026-10-23')
    next()
    expect(useCalendar.getState().anchor).toBe('2026-10-24')
    set('day', '2026-10-23')
    previous()
    expect(useCalendar.getState().anchor).toBe('2026-10-22')
    today()
    expect(useCalendar.getState().anchor).toBe('2026-10-23')
    set('day', '2025-01-01')
    today()
    expect(useCalendar.getState()).toMatchObject({ anchor: '2026-10-23', view: 'day' })
  })

  test('arrow keys step by view', () => {
    const a = '2026-10-23'
    expect(arrowStep('month', a, 'ArrowLeft')).toBe('2026-09-23')
    expect(arrowStep('month', a, 'ArrowRight')).toBe('2026-11-23')
    expect(arrowStep('month', a, 'ArrowUp')).toBe('2025-10-23')
    expect(arrowStep('month', a, 'ArrowDown')).toBe('2027-10-23')
    expect(arrowStep('week', a, 'ArrowLeft')).toBe('2026-10-16')
    expect(arrowStep('week', a, 'ArrowRight')).toBe('2026-10-30')
    expect(arrowStep('week', a, 'ArrowUp')).toBe('2026-09-23')
    expect(arrowStep('week', a, 'ArrowDown')).toBe('2026-11-23')
    for (const v of ['day', 'rolling'] as const) {
      expect(arrowStep(v, a, 'ArrowLeft')).toBe('2026-10-22')
      expect(arrowStep(v, a, 'ArrowRight')).toBe('2026-10-24')
      expect(arrowStep(v, a, 'ArrowUp')).toBe('2026-10-16')
      expect(arrowStep(v, a, 'ArrowDown')).toBe('2026-10-30')
    }
    set('week', a)
    useCalendar.getState().step('ArrowDown')
    expect(useCalendar.getState().anchor).toBe('2026-11-23')
  })

  test('persisted view kept, anchor reset to today', async () => {
    useCalendar.getState().setView('week')
    useCalendar.getState().setAnchor('2026-01-05')
    const saved = JSON.parse(localStorage.getItem('object.calendar') ?? '{}')
    expect(saved.state).toEqual({ view: 'week' })
    // A stored anchor (an older build, a hand edit) is dropped too.
    set('day', '2026-01-05')
    localStorage.setItem('object.calendar', JSON.stringify({ state: { view: 'month', anchor: '2020-02-02' }, version: 1 }))
    await useCalendar.persist.rehydrate()
    expect(useCalendar.getState()).toMatchObject({ view: 'month', anchor: '2026-10-23' })
  })

  test('a malformed stored view falls back and storage errors never throw', async () => {
    set('day', '2026-10-01')
    localStorage.setItem('object.calendar', JSON.stringify({ state: { view: 'year' }, version: 1 }))
    await useCalendar.persist.rehydrate()
    expect(useCalendar.getState().view).toBe('day')
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => useCalendar.getState().setView('week')).not.toThrow()
    spy.mockRestore()
  })
})
