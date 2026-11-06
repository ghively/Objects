// M22 Task 1: the work model contract on the front end: the three new property kinds, their
// menu, filter rows and cells, the work types' labels, the client calls and `StepChangedError`.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, ApiError, CLIENT_ID, ConflictError, StepChangedError } from '@/api/client'
import {
  KIND_TRANSFORMS,
  PROPERTY_TYPES,
  STAGE_LABELS,
  STEP_KIND_LABELS,
  STEP_STATE_LABELS,
  TURN_LABELS,
} from '@/api/types'
import { cellFor } from '@/properties/cellFor'
import { ADD_PROPERTY_ITEMS, KIND_META } from '@/properties/kinds'
import { settingsDefaults } from '@/settings/defaults'
import { SETTINGS_SECTIONS } from '@/settings/SettingsModal'
import { workItem, workStep, workWriteResult } from '@/test/mockApi'
import { FILTER_OPTIONS } from '@/views/filter'
import { DEFAULT_COL_WIDTH } from '@/views/table/tableConfig'

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('test M22 contract', () => {
  test('the three kinds: names, icons, menu, transforms, filters, widths and cells', () => {
    expect(KIND_META.steps).toEqual({
      name: 'Steps',
      description: 'An ordered list of questions, things to do, approvals and agent work.',
      icon: 'ph-list-checks',
    })
    expect(KIND_META.textList).toEqual({ name: 'List', description: 'A list of short texts.', icon: 'ph-list-bullets' })
    expect(KIND_META.floorItems).toEqual({
      name: 'Floor items',
      description: 'Things to look at or collect on the floor.',
      icon: 'ph-clipboard-text',
    })
    expect(PROPERTY_TYPES).toEqual(expect.arrayContaining(['steps', 'textList', 'floorItems']))
    expect(KIND_TRANSFORMS.steps).toEqual([])
    expect(KIND_TRANSFORMS.textList).toEqual([])
    expect(KIND_TRANSFORMS.floorItems).toEqual([])
    // Only List is addable, right after Button.
    expect(ADD_PROPERTY_ITEMS.slice(-2).map((i) => i.name)).toEqual(['Button', 'List'])
    expect(ADD_PROPERTY_ITEMS.at(-1)).toMatchObject({ key: 'property_textList', action: 'property', type: 'textList' })
    expect(ADD_PROPERTY_ITEMS.some((i) => i.type === 'steps' || i.type === 'floorItems')).toBe(false)
    expect(FILTER_OPTIONS.textList.map((x) => x.key)).toEqual(['contains', 'notContains', 'isEmpty', 'isNotEmpty'])
    expect(FILTER_OPTIONS.textList.map((x) => x.label).slice(0, 2)).toEqual(['includes', 'does not include'])
    expect(FILTER_OPTIONS.steps.map((x) => x.key)).toEqual(['isEmpty', 'isNotEmpty'])
    expect(FILTER_OPTIONS.floorItems.map((x) => x.key)).toEqual(['isEmpty', 'isNotEmpty'])
    expect([DEFAULT_COL_WIDTH.steps, DEFAULT_COL_WIDTH.textList, DEFAULT_COL_WIDTH.floorItems]).toEqual([18, 16, 12])
    for (const k of ['steps', 'textList', 'floorItems'] as const) expect(cellFor(k)).toBeTruthy()
  })

  test('the labels, the settings default and the Work section', () => {
    expect(STEP_KIND_LABELS).toEqual({ question: 'Question', do: 'Do', approve: 'Approve', agent: 'Agent' })
    expect(STEP_STATE_LABELS).toEqual({ open: 'Open', approved: 'Approved', done: 'Done', declined: 'Declined' })
    expect(STAGE_LABELS.parked).toBe('Waiting / parked')
    expect(STAGE_LABELS).toEqual({
      notStarted: 'Not started',
      ready: 'Ready',
      doing: 'Doing',
      parked: 'Waiting / parked',
      done: 'Done',
    })
    expect(TURN_LABELS).toEqual({ you: 'you', approve: 'approve', agent: 'agent', parked: 'parked', close: 'close', none: 'none' })
    expect(settingsDefaults.activityName).toBe('Gene')
    const ids = SETTINGS_SECTIONS.map((s) => s.id)
    expect(ids.slice(ids.indexOf('automations'), ids.indexOf('automations') + 3)).toEqual(['automations', 'work', 'integrations'])
    expect(SETTINGS_SECTIONS.find((s) => s.id === 'work')).toMatchObject({ group: 'space', label: 'Work', icon: 'ph-briefcase' })
  })

  test('the test helpers build whole values', () => {
    const step = workStep({ id: 'r8k1pd', kind: 'approve' })
    expect(step).toMatchObject({ id: 'r8k1pd', kind: 'approve', state: 'open', n: 1, current: true })
    const item = workItem({ path: 'Tasks/Printer jams on line 3.md', steps: [step] })
    expect(item.title).toBe('Printer jams on line 3')
    expect(item.steps).toEqual([step])
    expect(workWriteResult({ item }).item).toBe(item)
  })

  test('workStep posts to /api/work/step', async () => {
    const res = workWriteResult({ version: 'v2' })
    const fetchMock = respond(200, res)
    vi.stubGlobal('fetch', fetchMock)
    const req = { path: 'Tasks/a.md', stepId: 'r8k1pd', stepRev: '0123456789ab', action: 'approve' as const }
    expect(await api.workStep(req)).toEqual(res)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/work/step')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ ...req, clientId: CLIENT_ID })
  })

  test('a 409 from workStep rejects with StepChangedError carrying the server detail', async () => {
    const step = workStep({ id: 'r8k1pd', state: 'approved' })
    vi.stubGlobal(
      'fetch',
      respond(409, { detail: 'This step changed. Look again.', currentVersion: 'v9', step }),
    )
    const err = await api
      .workStep({ path: 'Tasks/a.md', stepId: 'r8k1pd', stepRev: 'old', action: 'approve' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StepChangedError)
    expect(err).toBeInstanceOf(ConflictError)
    expect(err).toBeInstanceOf(ApiError)
    const e = err as StepChangedError
    expect(e.message).toBe('This step changed. Look again.')
    expect(e.currentVersion).toBe('v9')
    expect(e.step).toEqual(step)
  })

  test('the other work calls hit their routes', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      const body = url.startsWith('/api/work/items')
        ? { items: [] }
        : url.includes('/work-fields')
          ? { type: {}, added: [], skipped: [] }
          : workWriteResult()
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await api.workItems()).toEqual([])
    await api.workItems('all')
    await api.workItem('Tasks/a.md')
    await api.workSteps('Tasks/a.md', [{ op: 'add', kind: 'do', text: 'Check the cable' }])
    await api.workFields('Tasks/a.md', { rank: 2 }, ['hypothesis'], 'v1')
    await api.workNote('Tasks/a.md', 'request', 'Look at the log')
    await api.workClose('Tasks/a.md', 'v1')
    await api.workFloor({ path: 'Tasks/a.md', op: 'add', place: 'Line 3 printer', what: 'Photo of the panel' })
    await api.addWorkFields('project', 'r1')
    const calls = fetchMock.mock.calls.map(([url, init]) => [
      url,
      init?.method ?? 'GET',
      init?.body ? JSON.parse(String(init.body)) : null,
    ])
    expect(calls).toEqual([
      ['/api/work/items', 'GET', null],
      ['/api/work/items?scope=all', 'GET', null],
      ['/api/work/item?path=Tasks%2Fa.md', 'GET', null],
      ['/api/work/steps', 'POST', { path: 'Tasks/a.md', ops: [{ op: 'add', kind: 'do', text: 'Check the cable' }], clientId: CLIENT_ID }],
      ['/api/work/fields', 'POST', { path: 'Tasks/a.md', baseVersion: 'v1', set: { rank: 2 }, remove: ['hypothesis'], clientId: CLIENT_ID }],
      ['/api/work/note', 'POST', { path: 'Tasks/a.md', kind: 'request', text: 'Look at the log', clientId: CLIENT_ID }],
      ['/api/work/close', 'POST', { path: 'Tasks/a.md', baseVersion: 'v1', clientId: CLIENT_ID }],
      ['/api/work/floor', 'POST', { path: 'Tasks/a.md', op: 'add', place: 'Line 3 printer', what: 'Photo of the panel', clientId: CLIENT_ID }],
      ['/api/types/project/work-fields', 'POST', { baseRevision: 'r1', clientId: CLIENT_ID }],
    ])
  })

  test('a 409 from workSteps and workFloor is a StepChangedError too', async () => {
    vi.stubGlobal('fetch', respond(409, { detail: 'This floor item changed. Look again.', currentVersion: 'v3' }))
    const e = await api.workFloor({ path: 'a.md', op: 'remove', itemId: 'f1', itemRev: 'x' }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(StepChangedError)
    expect((e as StepChangedError).message).toBe('This floor item changed. Look again.')
    expect((e as StepChangedError).step).toBeNull()
    vi.stubGlobal('fetch', respond(409, { detail: 'This step changed. Look again.', currentVersion: 'v4', step: null }))
    const e2 = await api.workSteps('a.md', [{ op: 'remove', stepId: 's1', stepRev: 'x' }]).catch((x: unknown) => x)
    expect(e2).toBeInstanceOf(StepChangedError)
    // workFields' 409 is a plain version conflict.
    vi.stubGlobal('fetch', respond(409, { detail: 'This item changed. Look again.', currentVersion: 'v5' }))
    const e3 = await api.workFields('a.md', { rank: 1 }, [], 'v1').catch((x: unknown) => x)
    expect(e3).toBeInstanceOf(ConflictError)
    expect(e3).not.toBeInstanceOf(StepChangedError)
    expect((e3 as ConflictError).currentVersion).toBe('v5')
  })
})
