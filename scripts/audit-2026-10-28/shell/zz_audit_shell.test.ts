import { describe, it, expect, vi } from 'vitest'
import { weekNumber, monthGrid, addDays, addMonths, startOfWeek, rangeFor, parseYmd } from '@/calendar/dates'
import { moveDate } from '@/calendar/DaySections'
import { deadlineText } from '@/tasks/DeadlineLabel'
import { useSettings } from '@/settings/useSettings'
import { zonedToday } from '@/lib/zonedTime'
import { sectionRows } from '@/tasks/taskSections'
import { maybeOverdue } from '@/tasks/taskActions'

describe('audit', () => {
  it('tz', () => { console.log('TZ', Intl.DateTimeFormat().resolvedOptions().timeZone, new Date(2026,10,1).getTimezoneOffset()) })
  it('weeks', () => {
    const cases = ['2026-01-01','2027-01-01','2026-12-31','2020-12-31','2021-01-03','2024-12-29','2026-01-04']
    for (const c of cases) console.log(c, weekNumber(c,'monday'), weekNumber(c,'sunday'))
    console.log(monthGrid(2026, 11, 'sunday')[0], monthGrid(2026,3,'monday')[5])
    console.log(addMonths('2026-01-31',1), rangeFor('month','2026-02-10','monday').to, startOfWeek('2026-11-01','monday'))
  })
  it('moveDate zone mismatch', () => {
    useSettings.setState({ settings: { ...useSettings.getState().settings, timeZone: 'Pacific/Auckland' } })
    const v = { start: '2026-10-28T22:00:00.000Z', resolution: 'time' as const }
    const r = moveDate(v, '2026-10-30')
    console.log('moveDate ->', r.start, new Intl.DateTimeFormat('en-CA',{timeZone:'Pacific/Auckland',dateStyle:'short',timeStyle:'short'}).format(new Date(r.start)))
    useSettings.setState({ settings: { ...useSettings.getState().settings, timeZone: null } })
  })
  it('moveDate DST device', () => {
    const v = { start: '2026-10-31T13:00:00.000Z', resolution: 'time' as const }
    const r = moveDate(v, '2026-11-02')
    console.log('moveDate DST ->', v.start, r.start)
  })
  it('today section vs zoned', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T01:00:00Z'))
    useSettings.setState({ settings: { ...useSettings.getState().settings, timeZone: 'Pacific/Auckland' } })
    const row: any = { summary: { path: 'T.md' }, values: { date: { start: '2026-10-29', resolution: 'day' }, status: 'Not started', repeat: 'every day' } }
    const type: any = undefined
    console.log('zonedToday', zonedToday(), 'today section has 29th task:', sectionRows('today', [row], type, new Date()).length)
    console.log('deadline 2026-10-29 from now:', deadlineText({ start: '2026-10-29', resolution: 'day' } as any))
    const row2: any = { summary: { path: 'T.md' }, values: { date: { start: '2026-10-28', resolution: 'day' }, repeat: 'every day' } }
    console.log('maybeOverdue 28th', maybeOverdue(row2))
    useSettings.setState({ settings: { ...useSettings.getState().settings, timeZone: null } })
    vi.useRealTimers()
  })
})
