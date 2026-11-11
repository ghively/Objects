// M23 Task 8: the Work page's data: parts load in parallel, a failing part keeps the others, and
// change events reload the parts they touch once per 300 ms burst.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { ChangeEvent } from '@/api/types'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { propertyDef, typeDef, workBoard, workBoardItem } from '@/test/mockApi'
import { EVENTS_DEBOUNCE_MS, partsForEvent, resetWorkData, useWorkData, useWorkEvents } from './useWorkData'
import { setWorkOn } from '@/test/workOn'

// M32: Work is on for the space in these tests (while it is off, nothing of the Work page runs).
beforeEach(() => setWorkOn())

const mocked = vi.mocked(api)

const TYPES = [
  typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks', folder: 'Tasks' }),
  typeDef({ id: 'dailynote', name: 'Daily Note', pluralName: 'Daily Notes', folder: 'DailyNotes' }),
  typeDef({ id: 'meeting', name: 'Meeting', pluralName: 'Meetings', folder: 'Meetings' }),
  typeDef({
    id: 'alert',
    name: 'Alert',
    pluralName: 'Alerts',
    folder: 'Alerts',
    propertyDefinitions: [
      propertyDef({ id: 'alertKey', key: 'alertKey', name: 'Alert key', type: 'text' }),
      propertyDef({ id: 'severity', key: 'severity', name: 'Severity', type: 'label' }),
    ],
  }),
]

describe('useWorkData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkData()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('test the default parts load in parallel', async () => {
    const started: string[] = []
    const gates: (() => void)[] = []
    const gate = <T,>(name: string, value: T) => () => {
      started.push(name)
      return new Promise<T>((resolve) => gates.push(() => resolve(value)))
    }
    mocked.workBoard.mockImplementationOnce(gate('board', workBoard([workBoardItem()])))
    mocked.workFocus.mockImplementationOnce(gate('focus', { day: '2026-11-05', notePath: null, version: null, hasSection: false, lines: [] }))
    const p = useWorkData.getState().load()
    // Every part was asked for before any answered.
    expect(started).toEqual(['board', 'focus'])
    expect(mocked.workToday).toHaveBeenCalledTimes(1)
    expect(mocked.workAlerts).toHaveBeenCalledTimes(1)
    expect(mocked.workAgent).toHaveBeenCalledTimes(1)
    expect(mocked.workCaptures).toHaveBeenCalledWith('needsYou')
    expect(mocked.workWins).not.toHaveBeenCalled()
    expect(mocked.generalFloor).not.toHaveBeenCalled()
    for (const g of gates) g()
    await p
    const s = useWorkData.getState()
    expect(s.board?.items).toHaveLength(1)
    expect(s.focus?.day).toBe('2026-11-05')
    expect(s.agent?.available).toBe(false)
    expect(s.needsYou).toEqual([])
    expect(s.all).toBeNull()
  })

  test('test a failing alerts keeps the board', async () => {
    mocked.workAlerts.mockRejectedValueOnce(new Error('The monitoring folder is gone.'))
    await useWorkData.getState().load(['board', 'alerts'])
    const s = useWorkData.getState()
    expect(s.board).not.toBeNull()
    expect(s.alerts).toBeNull()
    expect(s.error).toEqual({ alerts: 'The monitoring folder is gone.' })
    await useWorkData.getState().load(['alerts'])
    expect(useWorkData.getState().error).toEqual({})
  })

  test('test all and wins load when asked', async () => {
    await useWorkData.getState().load(['all', 'wins', 'general'])
    expect(mocked.workBoard).toHaveBeenCalledWith('all')
    expect(mocked.workWins).toHaveBeenCalledTimes(1)
    expect(mocked.generalFloor).toHaveBeenCalledTimes(1)
  })

  test('test hide and unhide', () => {
    useWorkData.getState().hide('A.md#s1')
    expect([...useWorkData.getState().hidden]).toEqual(['A.md#s1'])
    useWorkData.getState().unhide('A.md#s1')
    expect(useWorkData.getState().hidden.size).toBe(0)
  })

  test('test which parts an event touches', () => {
    const ev = (kind: ChangeEvent['kind'], path: string): ChangeEvent => ({ kind, path, version: null })
    expect(partsForEvent(ev('changed', 'Tasks/A.md'), TYPES, false)).toEqual(['board', 'needsYou'])
    expect(partsForEvent(ev('changed', 'Tasks/A.md'), TYPES, true)).toEqual(['board', 'needsYou', 'all'])
    expect(partsForEvent(ev('changed', 'DailyNotes/2026-11-05.md'), TYPES, false)).toEqual(['board', 'needsYou', 'focus', 'today'])
    expect(partsForEvent(ev('created', 'Meetings/Standup.md'), TYPES, false)).toEqual(['board', 'needsYou', 'focus', 'today'])
    expect(partsForEvent(ev('deleted', 'Alerts/Tray 2 jammed.md'), TYPES, false)).toEqual(['board', 'needsYou', 'alerts'])
    expect(partsForEvent(ev('types', 'task'), TYPES, false)).toEqual(['board', 'needsYou'])
    expect(partsForEvent(ev('work', 'floor'), TYPES, false)).toEqual(['general'])
    expect(partsForEvent(ev('workQueue', '*'), TYPES, false)).toEqual(['agent'])
    expect(partsForEvent(ev('ui', 'ui.json'), TYPES, false)).toEqual([])
    // Fix pass H: Wins (once loaded) follows every object change; Alerts follows the settings
    // (the monitoring folder and its intervals).
    expect(partsForEvent(ev('changed', 'Tasks/A.md'), TYPES, false, true)).toEqual(['board', 'needsYou', 'wins'])
    expect(partsForEvent(ev('settings', 'settings.json'), TYPES, false)).toEqual(['alerts'])
  })

  test('test events reload the right parts once per burst', async () => {
    vi.useFakeTimers()
    useSpaceInfo.setState({ space: { name: 'Work', root: 'C:/Spaces/Work', types: TYPES, workOn: true }, loaded: true })
    let emit: (e: ChangeEvent) => void = () => undefined
    mocked.onChange.mockImplementation((cb) => {
      emit = cb
      return () => undefined
    })
    const { unmount } = renderHook(() => useWorkEvents())

    act(() => {
      emit({ kind: 'workQueue', path: '*', version: null })
      emit({ kind: 'workQueue', path: 'q1', version: null })
      emit({ kind: 'workQueue', path: 'q2', version: null })
    })
    expect(mocked.workAgent).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(EVENTS_DEBOUNCE_MS)
    })
    expect(mocked.workAgent).toHaveBeenCalledTimes(1)
    expect(mocked.workBoard).not.toHaveBeenCalled()

    act(() => {
      emit({ kind: 'changed', path: 'Tasks/A.md', version: 'v2' })
      emit({ kind: 'changed', path: 'Tasks/B.md', version: 'v3' })
    })
    await act(async () => {
      vi.advanceTimersByTime(EVENTS_DEBOUNCE_MS)
    })
    expect(mocked.workBoard).toHaveBeenCalledTimes(1)
    expect(mocked.workCaptures).toHaveBeenCalledTimes(1)
    expect(mocked.workCaptures).toHaveBeenCalledWith('needsYou')
    expect(mocked.workAgent).toHaveBeenCalledTimes(1)
    expect(mocked.workFocus).not.toHaveBeenCalled()
    expect(mocked.workAlerts).not.toHaveBeenCalled()
    unmount()
    useSpaceInfo.setState({ space: null, loaded: false })
  })
})
