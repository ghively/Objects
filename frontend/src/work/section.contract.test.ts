// M23 Task 1: the Work section contract on the front end: icons, strings, the client calls and
// their errors, the board fixture's shape, the navigation targets, the settings defaults and the
// test helpers.
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, CLIENT_ID, ConflictError, StepChangedError, UnavailableError } from '@/api/client'
import type { ChangeEvent, WorkBoard } from '@/api/types'
import { appIcons } from '@/icons/appIcons'
import { sameTarget } from '@/nav/tabs'
import { settingsDefaults } from '@/settings/defaults'
import { agentStatus, deviceSettings, focusDay, workAlerts, workBoard, workBoardItem } from '@/test/mockApi'
import boardJson from './__fixtures__/board.json'
import { WORK_ICONS } from './workIcons'
import { WORK_TEXT } from './workText'

// `satisfies` makes tsc check the fixture against the Contract's `WorkBoard`. A JSON import's
// strings are plain `string`s (never literal unions), so the check is against `WorkBoard` with its
// string unions widened; the test below checks those values against their unions at run time.
type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? Widen<U>[]
    : T extends object
      ? { [K in keyof T]: Widen<T[K]> }
      : T
const board = (boardJson satisfies Widen<WorkBoard>) as unknown as WorkBoard

function respond(status: number, body: unknown) {
  return vi.fn(async () =>
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
}

function lastCall(fetchMock: ReturnType<typeof respond>): { url: string; init: RequestInit | undefined } {
  const calls = fetchMock.mock.calls as unknown as [string, RequestInit | undefined][]
  const [url, init] = calls[calls.length - 1]
  return { url, init }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('test M23 contract', () => {
  test('every work icon is a Phosphor id in the app subset', () => {
    const require = createRequire(join(process.cwd(), 'package.json'))
    const full = require('@iconify-json/ph/icons.json') as { icons: Record<string, unknown>; aliases?: Record<string, unknown> }
    for (const [key, id] of Object.entries(WORK_ICONS)) {
      expect(id.startsWith('ph-'), key).toBe(true)
      const name = id.slice(3)
      expect(!!full.icons[name] || !!full.aliases?.[name], `${id} in Phosphor`).toBe(true)
      expect(!!appIcons.icons[name] || !!appIcons.aliases?.[name], `${id} in appIcons`).toBe(true)
    }
    expect(WORK_ICONS).toMatchObject({ work: 'ph-briefcase', agent: 'ph-robot', capture: 'ph-lightbulb', smaller: 'ph-stairs' })
  })

  test('the strings', () => {
    expect(WORK_TEXT.approveArmed).toBe('Press again to approve')
    expect(WORK_TEXT.focusCleared(2)).toBe('Focus 2 cleared')
    expect(WORK_TEXT.agentPill(3, 1)).toBe('Agent is carrying 3 · 1 alerts')
    expect(WORK_TEXT.nothingWaiting).toBe('Nothing is waiting on you')
    expect(WORK_TEXT.allQuiet).toBe('All quiet')
    expect(WORK_TEXT.hiddenOnPurpose(2)).toBe('+2 more hidden on purpose')
    expect(WORK_TEXT.noStreaks).toBe('No streaks to break. This only grows.')
    expect(WORK_TEXT.stepChanged).toBe('This step changed. Look again.')
    expect(WORK_TEXT.focusChanged).toBe("Today's note changed. Look again.")
    expect(WORK_TEXT.breakDown('INC0012345', 2, 'Restart it')).toBe('Break down INC0012345 step 2: Restart it')
  })

  test('workCapture posts to the captures route and a 501 rejects with UnavailableError', async () => {
    const fetchMock = respond(501, { detail: 'Saving a brain dump comes with M24.' })
    vi.stubGlobal('fetch', fetchMock)
    const err = await api.workCapture({ text: 'Spooler again', fromView: 'now' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UnavailableError)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('Saving a brain dump comes with M24.')
    const { url, init } = lastCall(fetchMock)
    expect(url).toBe('/api/work/captures')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ text: 'Spooler again', fromView: 'now', clientId: CLIENT_ID })

    for (const call of [() => api.setAgentActs(true), () => api.retryAgentEntry('q1'), () => api.openKeepOnTop()]) {
      vi.stubGlobal('fetch', respond(501, { detail: 'x' }))
      await expect(call()).rejects.toBeInstanceOf(UnavailableError)
    }
  })

  test('saveWorkFocus 409 rejects with ConflictError; the general floor 409 with StepChangedError', async () => {
    vi.stubGlobal('fetch', respond(409, { currentVersion: 'v9', detail: "Today's note changed. Look again." }))
    const err = await api.saveWorkFocus('2026-11-05', ['Clear the jams'], 'v1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect((err as ConflictError).currentVersion).toBe('v9')
    expect((err as ConflictError).message).toBe('conflict')

    vi.stubGlobal('fetch', respond(409, { detail: 'This floor item changed. Look again.' }))
    const floorErr = await api.generalFloorOp({ op: 'collect', itemId: 'a1b2c3', itemRev: 'r' }).catch((e: unknown) => e)
    expect(floorErr).toBeInstanceOf(StepChangedError)
    expect((floorErr as Error).message).toBe('This floor item changed. Look again.')
  })

  test('the calls hit their routes and writes announce locally', async () => {
    const seen: ChangeEvent[] = []
    vi.stubGlobal('EventSource', undefined)
    const off = api.onChange((e) => seen.push(e))
    try {
      const cases: [() => Promise<unknown>, string, string | undefined, unknown][] = [
        [() => api.workBoard(), '/api/work/board', undefined, workBoard()],
        [() => api.workBoard('all'), '/api/work/board?scope=all', undefined, workBoard()],
        [() => api.workFocus('2026-11-06'), '/api/work/focus?day=2026-11-06', undefined, focusDay()],
        [() => api.workToday(), '/api/work/today', undefined, { day: '2026-11-05', now: '', nowLocal: '10:00', meetings: [] }],
        [() => api.workWins(14), '/api/work/wins?days=14', undefined, { days: [], stepsDone: 0, itemsClosed: 0, objectsChanged: 0, got: [] }],
        [() => api.workAlerts(), '/api/work/alerts', undefined, workAlerts()],
        [() => api.scanAlerts(), '/api/work/alerts/scan', 'POST', { report: {}, alerts: workAlerts() }],
        [() => api.generalFloor(), '/api/work/floor/general', undefined, { items: [], revision: '' }],
        [() => api.workAgent(), '/api/work/agent', undefined, agentStatus()],
        [() => api.workCaptures('needsYou'), '/api/work/captures?status=needsYou', undefined, { captures: [] }],
        [() => api.keepOnTopInfo(), '/api/work/keep-on-top', undefined, { window: false }],
      ]
      for (const [call, url, method, body] of cases) {
        const fetchMock = respond(200, body)
        vi.stubGlobal('fetch', fetchMock)
        await call()
        const last = lastCall(fetchMock)
        expect(last.url).toBe(url)
        expect(last.init?.method).toBe(method)
      }
      expect(await api.workCaptures()).toEqual([])

      vi.stubGlobal('fetch', respond(204, null))
      await expect(api.openKeepOnTop()).resolves.toBeUndefined()

      vi.stubGlobal('fetch', respond(200, focusDay(['Clear the jams'])))
      await api.saveWorkFocus('2026-11-05', ['Clear the jams'], 'v1')
      vi.stubGlobal('fetch', respond(200, { items: [], revision: 'r2' }))
      await api.generalFloorOp({ op: 'add', place: 'Line 3', what: 'Photo of the panel' })
      await new Promise((r) => setTimeout(r, 0))
      expect(seen).toContainEqual({ kind: 'changed', path: 'DailyNotes/2026-11-05.md', version: 'v1', origin: CLIENT_ID })
      expect(seen).toContainEqual({ kind: 'work', path: 'floor', version: 'r2', origin: CLIENT_ID })
    } finally {
      off()
    }
  })

  test('board.json mirrors the overlay space', () => {
    const byTitle = new Map(board.items.map((i) => [i.title, i]))
    expect(board.today).toBe('2026-11-05')
    expect(byTitle.get('Printer jams on line 3')).toMatchObject({ turn: 'approve', stage: 'doing', isProject: false })
    expect(byTitle.get('Printer jams on line 3')?.current?.n).toBe(2)
    expect(byTitle.get('Waiting on Pat')).toMatchObject({
      deadline: '2026-11-12',
      blockedOnPeople: [{ path: 'People/Pat Example.md', title: 'Pat Example' }],
    })
    expect(byTitle.get('Scanner firmware')).toMatchObject({ projectPath: 'Projects/Scanner rollout.md', area: 'Scanners' })
    expect(byTitle.get('Scanner firmware')?.steps).toHaveLength(2)
    expect(byTitle.get('Scanner rollout')).toMatchObject({ isProject: true, typeName: 'Project' })
    expect(byTitle.get('Parked thing')?.turn).toBe('parked')
    expect(byTitle.has('Old cleanup')).toBe(false)
    const stages = ['notStarted', 'ready', 'doing', 'parked', 'done']
    const turns = ['you', 'approve', 'agent', 'parked', 'close', 'none']
    const kinds = ['question', 'do', 'approve', 'agent']
    const states = ['open', 'approved', 'done', 'declined']
    const actions = ['answer', 'done', 'approve', 'decline', 'run', 'reopen', 'complete', 'fail']
    for (const item of board.items) {
      expect(item).not.toHaveProperty('fields')
      expect(item).not.toHaveProperty('activity')
      expect(stages).toContain(item.stage)
      expect(turns).toContain(item.turn)
      for (const s of item.steps) {
        expect(s.id && s.rev).toBeTruthy()
        expect(kinds).toContain(s.kind)
        expect(states).toContain(s.state)
        for (const a of s.actions) expect(actions).toContain(a)
      }
    }
  })

  test('the work targets, the settings defaults and the helpers', () => {
    expect(sameTarget({ kind: 'work' }, { kind: 'work' })).toBe(true)
    expect(sameTarget({ kind: 'work', view: 'now' }, { kind: 'work', view: 'flow' })).toBe(false)
    expect(sameTarget({ kind: 'object', path: 'a.md', work: true }, { kind: 'object', path: 'a.md' })).toBe(false)
    expect(sameTarget({ kind: 'object', path: 'a.md', work: true }, { kind: 'object', path: 'a.md', work: true })).toBe(true)

    expect(settingsDefaults.workAlertFolder).toBeNull()
    expect(settingsDefaults.workAlertIntervals).toEqual({})
    expect(deviceSettings()).toMatchObject({ workAlertFolder: null, workAlertIntervals: {} })

    const item = workBoardItem({ path: 'Tasks/Waiting on Pat.md', deadline: '2026-11-12' })
    expect(item).toMatchObject({ title: 'Waiting on Pat', typeName: 'Task', isProject: false, blockedOnPeople: [], steps: [] })
    expect(item).not.toHaveProperty('fields')
    expect(workBoard([item]).items).toHaveLength(1)
    const day = focusDay(['Clear the jams on [[Printer jams on line 3]]', 'Ship [[Scanner rollout|the scanners]]'])
    expect(day.lines.map((l) => [l.n, l.label])).toEqual([
      [1, 'Clear the jams on Printer jams on line 3'],
      [2, 'Ship the scanners'],
    ])
    expect(day.lines[1].links).toEqual([{ target: 'Scanner rollout', path: null }])
    expect(agentStatus({ carrying: 2 })).toMatchObject({ available: false, carrying: 2, rows: [] })
    expect(workAlerts().counts).toEqual({ Critical: 0, Warning: 0, Info: 0 })
  })
})
