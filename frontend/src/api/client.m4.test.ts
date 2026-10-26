import { afterEach, describe, expect, test, vi } from 'vitest'
import type { CalendarRange, ChangeEvent } from './types'
import { api, ApiError, CLIENT_ID, DailyNoteExistsError } from './client'
import { calendarDay, calendarRange, taskEntry } from '@/test/mockApi'

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  return JSON.parse((fetchMock.mock.calls[call] as unknown as [string, RequestInit])[1].body as string)
}

function urlOf(fetchMock: ReturnType<typeof vi.fn>, call = 0): string {
  return (fetchMock.mock.calls[call] as unknown as [string, RequestInit])[0]
}

async function collect(run: () => Promise<unknown>): Promise<ChangeEvent[]> {
  const seen: ChangeEvent[] = []
  const off = api.onChange((e) => seen.push(e))
  try {
    await run()
    await new Promise((r) => setTimeout(r, 0))
  } finally {
    off()
  }
  return seen
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api client M4', () => {
  test('test calendar requests the range and returns days', async () => {
    const range: CalendarRange = calendarRange({
      from: '2026-10-01',
      to: '2026-10-31',
      today: '2026-10-26',
      days: {
        '2026-10-26': calendarDay({
          dailyNote: { path: 'DailyNotes/2026-10-26.md', reviewed: false },
          tasks: [taskEntry({ path: 'Tasks/Call.md', day: '2026-10-26' })],
        }),
      },
    })
    const fetchMock = respond(200, range)
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.calendar('2026-10-01', '2026-10-31')).resolves.toEqual(range)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(urlOf(fetchMock)).toBe('/api/calendar?from=2026-10-01&to=2026-10-31')
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.method ?? 'GET').toBe('GET')
  })

  test('test createDailyNote 409 throws DailyNoteExistsError with path', async () => {
    const fetchMock = respond(409, { detail: { detail: 'A daily note for this day exists', path: 'DailyNotes/2026-10-26.md' } })
    vi.stubGlobal('fetch', fetchMock)
    const err = await api.createDailyNote('2026-10-26').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DailyNoteExistsError)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as DailyNoteExistsError).status).toBe(409)
    expect((err as DailyNoteExistsError).path).toBe('DailyNotes/2026-10-26.md')
    expect(urlOf(fetchMock)).toBe('/api/daily-notes')
    expect(bodyOf(fetchMock)).toEqual({ date: '2026-10-26', clientId: CLIENT_ID })
  })

  test('createDailyNote 201 sends templateId and emits created and types events', async () => {
    const fetchMock = respond(201, { path: 'DailyNotes/2026-10-26.md', version: 'v1', typeIds: ['dailynote'] })
    vi.stubGlobal('fetch', fetchMock)
    let res: unknown
    const seen = await collect(async () => {
      res = await api.createDailyNote('2026-10-26', { templateId: 'none' })
    })
    expect(res).toEqual({ path: 'DailyNotes/2026-10-26.md', version: 'v1', typeIds: ['dailynote'] })
    expect(bodyOf(fetchMock)).toEqual({ date: '2026-10-26', templateId: 'none', clientId: CLIENT_ID })
    expect(seen).toEqual([
      { kind: 'created', path: 'DailyNotes/2026-10-26.md', version: 'v1', origin: CLIENT_ID },
      { kind: 'types', path: 'dailynote', version: null, origin: CLIENT_ID },
    ])
  })

  test('createDailyNote 422 is a plain ApiError', async () => {
    vi.stubGlobal('fetch', respond(422, { detail: 'Bad date' }))
    const err = await api.createDailyNote('2026-13-01').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).not.toBeInstanceOf(DailyNoteExistsError)
    expect((err as ApiError).message).toBe('Bad date')
  })

  test('test updateProperties returns task result', async () => {
    const task = { completed: true, advanced: true, date: { start: '2026-10-27', resolution: 'day' as const } }
    const fetchMock = respond(200, {
      version: 'v2',
      frontmatter: { status: 'Not Started', date: '2026-10-27', completed: '2026-10-26T09:00:00Z' },
      links: {},
      synced: [],
      skipped: [],
      task,
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await api.updateProperties('Tasks/Call.md', { status: 'Done' }, 'v1')
    expect(res.task).toEqual(task)
    expect(bodyOf(fetchMock)).toEqual({ path: 'Tasks/Call.md', updates: { status: 'Done' }, baseVersion: 'v1', clientId: CLIENT_ID })
  })

  test('patchUi accepts calendar, tasks and reminders keys', async () => {
    const fetchMock = respond(200, { ui: { pinned: [], sections: [], allNotesLayout: 'list' }, revision: 'u2' })
    vi.stubGlobal('fetch', fetchMock)
    await api.patchUi(
      { calendar: { weekStart: 'monday', daily: { hideCreateObjects: true } }, reminders: { enabled: false } },
      { baseRevision: 'u1' },
    )
    expect(bodyOf(fetchMock)).toMatchObject({
      patch: { calendar: { weekStart: 'monday', daily: { hideCreateObjects: true } }, reminders: { enabled: false } },
      baseRevision: 'u1',
    })
  })
})
