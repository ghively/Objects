// M23 Task 8: the Work page's UI state persists per space in browser storage; today's Not now and
// focus line only; blocked storage keeps it in memory.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { zonedToday } from '@/lib/zonedTime'
import { focusLineToday, loadWorkUi, notNowToday, useWorkUi, WORK_UI_KEY } from './useWorkUi'

const A = 'C:/Spaces/Work'
const B = 'C:/Spaces/Home'

describe('useWorkUi', () => {
  beforeEach(() => {
    window.localStorage.clear()
    loadWorkUi(A)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  test('test values survive a reload of the store under the space key', () => {
    const s = useWorkUi.getState()
    s.setEnergy('low')
    s.setCalm(true)
    s.setView('flow')
    s.setFocusLine(2)
    s.addNotNow('Tasks/A.md')
    s.addNotNow('Tasks/B.md')
    s.setFlowArea('Printers')
    s.setEverythingSort({ key: 'title', dir: 1 })
    expect(window.localStorage.getItem(`${WORK_UI_KEY}:${A}`)).not.toBeNull()

    useWorkUi.setState({ energy: null, calm: false, view: 'now', focusLine: null, flowArea: null })
    loadWorkUi(A)
    const r = useWorkUi.getState()
    expect(r.energy).toBe('low')
    expect(r.calm).toBe(true)
    expect(r.view).toBe('flow')
    expect(focusLineToday(r)).toBe(2)
    expect([...notNowToday(r)]).toEqual(['Tasks/A.md', 'Tasks/B.md'])
    expect(r.flowArea).toBe('Printers')
    expect(r.everythingSort).toEqual({ key: 'title', dir: 1 })

    r.setFocusLine(null)
    r.setEnergy(null)
    loadWorkUi(A)
    expect(useWorkUi.getState().focusLine).toBeNull()
    expect(useWorkUi.getState().energy).toBeNull()
  })

  test('test another space has its own', () => {
    useWorkUi.getState().setEnergy('high')
    loadWorkUi(B)
    expect(useWorkUi.getState().energy).toBeNull()
    expect(useWorkUi.getState().view).toBe('now')
    useWorkUi.getState().setView('wins')
    loadWorkUi(A)
    expect(useWorkUi.getState().energy).toBe('high')
    expect(useWorkUi.getState().view).toBe('now')
  })

  test("test yesterday's Not now reads empty", () => {
    window.localStorage.setItem(
      `${WORK_UI_KEY}:${A}`,
      JSON.stringify({
        energy: 'medium',
        notNow: { day: '2000-01-01', paths: ['Tasks/A.md'] },
        focusLine: { day: '2000-01-01', n: 1 },
      }),
    )
    loadWorkUi(A)
    const s = useWorkUi.getState()
    expect(s.energy).toBe('medium')
    expect(notNowToday(s).size).toBe(0)
    expect(focusLineToday(s)).toBeNull()
    // A Not now kept from an earlier day in memory also reads empty, and the next one starts over.
    useWorkUi.setState({ notNow: { day: '2000-01-01', paths: ['Tasks/Old.md'] } })
    expect(notNowToday(useWorkUi.getState()).size).toBe(0)
    useWorkUi.getState().addNotNow('Tasks/New.md')
    expect(useWorkUi.getState().notNow).toEqual({ day: zonedToday(), paths: ['Tasks/New.md'] })
  })

  test("test a throwing localStorage doesn't break it", () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => loadWorkUi(A)).not.toThrow()
    expect(() => useWorkUi.getState().setEnergy('low')).not.toThrow()
    expect(useWorkUi.getState().energy).toBe('low')
    expect(() => useWorkUi.getState().addNotNow('Tasks/A.md')).not.toThrow()
    expect([...notNowToday(useWorkUi.getState())]).toEqual(['Tasks/A.md'])
  })

  test('test bad stored values fall back to the defaults', () => {
    window.localStorage.setItem(`${WORK_UI_KEY}:${A}`, '{not json')
    loadWorkUi(A)
    expect(useWorkUi.getState().view).toBe('now')
    window.localStorage.setItem(
      `${WORK_UI_KEY}:${A}`,
      JSON.stringify({ energy: 'huge', calm: 'yes', everythingSort: { key: 'nope', dir: 2 } }),
    )
    loadWorkUi(A)
    const s = useWorkUi.getState()
    expect(s.energy).toBeNull()
    expect(s.calm).toBe(false)
    expect(s.everythingSort).toEqual({ key: 'score', dir: -1 })
  })
})
