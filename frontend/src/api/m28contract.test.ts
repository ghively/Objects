// M28 Task 1: the Contract's types (counterparts, the IT ops setup) and `api.editCounterpart`.
import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest'
import { api, CLIENT_ID } from './client'
import type {
  Counterpart,
  CounterpartEditRequest,
  CounterpartEditResult,
  CounterpartRow,
  GraphData,
  ObjectDetail,
  PropertyOptions,
  SpaceSetup,
  TypeDef,
  TypeTemplate,
} from './types'
import { counterpartDef, counterpartRow, mockApi } from '@/test/mockApi'
import { COUNTERPART_TEXT, CounterpartRows } from '@/object/CounterpartRows'

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('test M28 contract', () => {
  test('test the counterpart shapes type-check', () => {
    const row: CounterpartRow = {
      key: 'runs',
      name: 'Runs',
      sourceTypeId: 'application',
      sourcePropertyKey: 'runsOn',
      paths: ['Applications/Inventory app.md'],
    }
    const result: CounterpartEditResult = {
      counterparts: [row],
      written: [{ path: 'Applications/Inventory app.md', version: 'v2' }],
      skipped: [{ path: 'Applications/Old app.md', reason: "It's gone." }],
    }
    const counterpart: Counterpart = { name: 'Runs', key: 'runs' }
    const options: PropertyOptions = {
      allowedTypes: ['host'],
      counterpart,
      counterpartOf: [{ typeId: 'application', key: 'runsOn' }],
    }
    const cleared: PropertyOptions = { counterpart: null }
    const setups: SpaceSetup[] = ['blank', 'basic', 'itops']
    const section: TypeTemplate['section'] = 'itOperations'
    const detail: Pick<ObjectDetail, 'counterparts'> = { counterparts: [row] }
    const type: Pick<TypeDef, 'counterparts'> = { counterparts: [counterpartDef({ key: 'runs' })] }
    const graph: Pick<GraphData, 'linkLabels'> = { linkLabels: ['Runs on', null] }
    expect(result.counterparts[0].paths).toEqual(['Applications/Inventory app.md'])
    expect([options.counterpart, cleared.counterpart, setups[2], section]).toEqual([counterpart, null, 'itops', 'itOperations'])
    expect([detail.counterparts?.length, type.counterparts?.length, graph.linkLabels?.length]).toEqual([1, 1, 2])
    expectTypeOf<'itops'>().toMatchTypeOf<SpaceSetup>()
    expectTypeOf<'itOperations'>().toMatchTypeOf<TypeTemplate['section']>()
    expectTypeOf<CounterpartEditRequest['clientId']>().toEqualTypeOf<string | undefined>()
  })

  test('test editCounterpart posts to its route', async () => {
    const answer: CounterpartEditResult = { counterparts: [counterpartRow()], written: [], skipped: [] }
    const fetchMock = respond(200, answer)
    vi.stubGlobal('fetch', fetchMock)
    const req: CounterpartEditRequest = {
      path: 'Hosts/DB-TEST-01.md',
      key: 'runs',
      sourceTypeId: 'application',
      add: ['Applications/Inventory app.md'],
      remove: [],
    }
    await expect(api.editCounterpart(req)).resolves.toEqual(answer)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/object/counterpart')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ ...req, clientId: CLIENT_ID })
  })

  test('test the mock helpers', async () => {
    expect(counterpartRow()).toEqual({
      key: 'runs',
      name: 'Runs',
      sourceTypeId: 'application',
      sourcePropertyKey: 'runsOn',
      paths: [],
    })
    const def = counterpartDef({ key: 'documentedIn', name: 'Documented in' })
    expect(def).toMatchObject({
      id: 'counterpart:documentedIn',
      key: 'documentedIn',
      name: 'Documented in',
      type: 'entity',
      visibility: 'hideWhenEmpty',
      icon: { type: 'iconify', val: 'ph-arrows-left-right' },
      options: { isArray: true, allowedTypes: [], hasFixedSet: false, fixedSet: [], counterpartOf: [] },
    })
    const mocked = mockApi()
    await expect(
      mocked.editCounterpart({ path: 'Hosts/A.md', key: 'runs', sourceTypeId: 'application', add: [], remove: [] }),
    ).resolves.toEqual({ counterparts: [], written: [], skipped: [] })
    expect(vi.isMockFunction(mocked.editCounterpart)).toBe(true)
  })

  test('test the CounterpartRows stub exports', () => {
    expect(typeof CounterpartRows).toBe('function')
    expect(COUNTERPART_TEXT.mixed).toBe('Pick one of {types}.')
  })
})
