import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, TypeDef } from './types'
import { api, ApiError, CLIENT_ID, ConfirmRequiredError, ConflictError, RevisionConflictError } from './client'

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api client', () => {
  test('a save that wrote is announced to other listeners in this window', async () => {
    const fetchMock = respond(200, { version: 'v2' })
    vi.stubGlobal('fetch', fetchMock)
    const seen: ChangeEvent[] = []
    const off = api.onChange((e) => seen.push(e))
    try {
      await expect(api.saveBody('Pages/A.md', 'x', 'v1')).resolves.toEqual({ version: 'v2' })
      const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
      expect(sent).toEqual({ path: 'Pages/A.md', body: 'x', baseVersion: 'v1', clientId: CLIENT_ID })
      expect(seen).toEqual([]) // after the caller has handled the result
      await new Promise((r) => setTimeout(r, 0))
      expect(seen).toEqual([{ kind: 'changed', path: 'Pages/A.md', version: 'v2', origin: CLIENT_ID }])

      // An unchanged body (same version back) is not a change.
      vi.stubGlobal('fetch', respond(200, { version: 'v2' }))
      await api.saveBody('Pages/A.md', 'x', 'v2')
      await new Promise((r) => setTimeout(r, 0))
      expect(seen).toHaveLength(1)
    } finally {
      off()
    }
  })

  test("errors carry the server's detail message", async () => {
    vi.stubGlobal('fetch', respond(404, { detail: "No object at 'X.md'" }))
    const err = await api.object('X.md').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(404)
    expect((err as ApiError).message).toBe("No object at 'X.md'")
  })

  test("a request the server's validation rejects (422) carries its messages", async () => {
    vi.stubGlobal(
      'fetch',
      respond(422, { detail: [{ loc: ['body', 'path'], msg: 'Field required', type: 'missing' }, { loc: ['query', 'limit'], msg: 'Input should be a valid integer', type: 'int_parsing' }] }),
    )
    const err = await api.object('X.md').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(422)
    expect((err as ApiError).message).toBe('path: Field required; limit: Input should be a valid integer')
  })
})

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

describe('api client v2 writes', () => {
  test('test updateProperties sends clientId and emits local changed for path and each synced path', async () => {
    const fetchMock = respond(200, {
      version: 'v2',
      frontmatter: { status: 'Done' },
      links: {},
      synced: ['B/B1.md', 'B/B2.md'],
      skipped: [],
    })
    vi.stubGlobal('fetch', fetchMock)
    let result: unknown
    const seen = await collect(async () => {
      result = await api.updateProperties('A/A1.md', { status: ['Done'] }, 'v1', ['old'])
    })
    expect(urlOf(fetchMock)).toBe('/api/object/properties')
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('PUT')
    expect(bodyOf(fetchMock)).toEqual({
      path: 'A/A1.md',
      updates: { status: ['Done'] },
      remove: ['old'],
      baseVersion: 'v1',
      clientId: CLIENT_ID,
    })
    expect((result as { synced: string[] }).synced).toEqual(['B/B1.md', 'B/B2.md'])
    expect(seen).toEqual([
      { kind: 'changed', path: 'A/A1.md', version: 'v2', origin: CLIENT_ID },
      { kind: 'changed', path: 'B/B1.md', version: null, origin: CLIENT_ID },
      { kind: 'changed', path: 'B/B2.md', version: null, origin: CLIENT_ID },
    ])
  })

  test('test renameObject emits local renamed and changed for each relinked path', async () => {
    const fetchMock = respond(200, {
      path: 'People/Ada King.md',
      version: 'v2',
      relinked: ['Pages/Ref.md'],
      skipped: [],
    })
    vi.stubGlobal('fetch', fetchMock)
    const seen = await collect(() => api.renameObject('People/Ada Lovelace.md', 'Ada King', 'v1'))
    expect(bodyOf(fetchMock)).toEqual({
      path: 'People/Ada Lovelace.md',
      title: 'Ada King',
      baseVersion: 'v1',
      clientId: CLIENT_ID,
    })
    expect(seen).toEqual([
      {
        kind: 'renamed',
        path: 'People/Ada King.md',
        oldPath: 'People/Ada Lovelace.md',
        version: 'v2',
        origin: CLIENT_ID,
      },
      { kind: 'changed', path: 'Pages/Ref.md', version: null, origin: CLIENT_ID },
    ])
  })

  test('test saveType sends baseRevision and emits types and changed for rewritten paths', async () => {
    const saved = { id: 'server', name: 'Machine', revision: 'r2' }
    const fetchMock = respond(200, { type: saved, rewritten: ['Servers/Alpha.md'], skipped: [] })
    vi.stubGlobal('fetch', fetchMock)
    const type = { id: 'server', name: 'Machine', revision: 'r1' } as unknown as TypeDef
    let result: unknown
    const seen = await collect(async () => {
      result = await api.saveType(type, { baseRevision: 'r1', confirm: true })
    })
    expect(urlOf(fetchMock)).toBe('/api/types/server')
    expect(bodyOf(fetchMock)).toEqual({ type, baseRevision: 'r1', confirm: true, clientId: CLIENT_ID })
    expect((result as { type: unknown }).type).toEqual(saved)
    expect(seen).toEqual([
      { kind: 'types', path: 'server', version: 'r2', origin: CLIENT_ID },
      { kind: 'changed', path: 'Servers/Alpha.md', version: null, origin: CLIENT_ID },
    ])
  })

  test('deleteType announces each trashed object, each touched type and each touched query locally', async () => {
    const fetchMock = respond(200, {
      trashId: 't1',
      paths: ['Servers/Alpha.md', 'Templates/Servers/Base.md'],
      typeIds: ['server', 'project'],
      queryIds: ['my-servers'],
    })
    vi.stubGlobal('fetch', fetchMock)
    let result: unknown
    const seen = await collect(async () => {
      result = await api.deleteType('server', { confirm: true })
    })
    expect(result).toEqual({ trashId: 't1' })
    expect(seen).toEqual([
      { kind: 'types', path: 'server', version: null, origin: CLIENT_ID },
      { kind: 'types', path: 'project', version: null, origin: CLIENT_ID },
      { kind: 'deleted', path: 'Servers/Alpha.md', version: null, origin: CLIENT_ID },
      { kind: 'deleted', path: 'Templates/Servers/Base.md', version: null, origin: CLIENT_ID },
      { kind: 'queries', path: 'my-servers', version: null, origin: CLIENT_ID },
    ])
  })

  test('deleting a template announces its type; creating an object announces a first-saved type', async () => {
    vi.stubGlobal('fetch', respond(200, { trashId: 't2', typeIds: ['project'] }))
    const deleted = await collect(() => api.deleteObject('Templates/Projects/Kickoff.md'))
    expect(deleted).toContainEqual({ kind: 'types', path: 'project', version: null, origin: CLIENT_ID })
    vi.stubGlobal('fetch', respond(201, { path: 'Gadgets/A.md', version: 'v1', typeIds: ['gadget'] }))
    const made = await collect(() => api.createObject('gadget'))
    expect(made).toContainEqual({ kind: 'types', path: 'gadget', version: null, origin: CLIENT_ID })
  })

  test('creating an object can carry its body (M14: the text is in the creating write)', async () => {
    const fetchSpy = respond(201, { path: 'Pages/A.md', version: 'v1' })
    vi.stubGlobal('fetch', fetchSpy)
    await api.createObject('page', { templateId: 'none', body: 'text\n' })
    await api.createObject('page', { title: 'A', appendBody: '- child\n' })
    const sent = (fetchSpy.mock.calls as unknown as [string, RequestInit][]).map(([, init]) => JSON.parse(String(init.body)))
    expect(sent[0]).toMatchObject({ typeId: 'page', templateId: 'none', body: 'text\n' })
    expect(sent[0]).not.toHaveProperty('appendBody')
    expect(sent[1]).toMatchObject({ typeId: 'page', title: 'A', appendBody: '- child\n' })
    expect(sent[1]).not.toHaveProperty('body')
  })

  test('test 409 on saveType maps to RevisionConflictError with currentRevision', async () => {
    vi.stubGlobal('fetch', respond(409, { detail: { currentRevision: 'r9' } }))
    const type = { id: 'server', revision: 'r1' } as unknown as TypeDef
    const err = await api.saveType(type, { baseRevision: 'r1' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RevisionConflictError)
    expect(err).toBeInstanceOf(ConflictError)
    expect((err as RevisionConflictError).currentRevision).toBe('r9')
    expect((err as RevisionConflictError).currentVersion).toBe('r9')
  })

  test('test 428 maps to ConfirmRequiredError with affected', async () => {
    vi.stubGlobal('fetch', respond(428, { detail: { detail: 'Delete this property from 3 objects?', affected: 3 } }))
    const type = { id: 'server', revision: 'r1' } as unknown as TypeDef
    const err = await api.saveType(type, { baseRevision: 'r1' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConfirmRequiredError)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ConfirmRequiredError).status).toBe(428)
    expect((err as ConfirmRequiredError).affected).toBe(3)
    expect((err as ConfirmRequiredError).message).toBe('Delete this property from 3 objects?')
  })

  test('test renamed SSE event delivered with oldPath', async () => {
    const sources: FakeEventSource[] = []
    class FakeEventSource extends EventTarget {
      readonly url: string
      closed = false
      constructor(url: string) {
        super()
        this.url = url
        sources.push(this)
      }
      close() {
        this.closed = true
      }
    }
    vi.stubGlobal('EventSource', FakeEventSource)
    const seen: ChangeEvent[] = []
    const off = api.onChange((e) => seen.push(e))
    try {
      expect(sources).toHaveLength(1)
      const event = { kind: 'renamed', path: 'Pages/New.md', oldPath: 'Pages/Old.md', version: 'v3', origin: 'other' }
      sources[0].dispatchEvent(new MessageEvent('change', { data: JSON.stringify(event) }))
      // Our own writes were already emitted locally: their echo is dropped.
      sources[0].dispatchEvent(
        new MessageEvent('change', { data: JSON.stringify({ ...event, origin: CLIENT_ID }) }),
      )
      expect(seen).toEqual([event])
      expect(seen[0].oldPath).toBe('Pages/Old.md')
    } finally {
      off()
    }
    expect(sources[0].closed).toBe(true)
  })

  test('test createMcpServer keeps a name clash 409 message and saveMcpServer a stale revision', async () => {
    vi.stubGlobal('fetch', respond(409, { detail: 'Another server already has this name.' }))
    const clash = await api.createMcpServer({ name: 'gh', enabled: true, kind: 'command', command: 'npx' }).catch((e: unknown) => e)
    expect(clash).toBeInstanceOf(ApiError)
    expect(clash).not.toBeInstanceOf(ConflictError)
    expect((clash as ApiError).status).toBe(409)
    expect((clash as ApiError).message).toBe('Another server already has this name.')
    vi.stubGlobal('fetch', respond(409, { detail: 'stale', currentRevision: 'r2' }))
    const stale = await api.saveMcpServer('01J', { name: 'gh', enabled: false, kind: 'command' }, 'r1').catch((e: unknown) => e)
    expect(stale).toBeInstanceOf(RevisionConflictError)
    expect((stale as RevisionConflictError).currentRevision).toBe('r2')
  })

  test('test agentLearning is a resync event', async () => {
    const sources: FakeSource[] = []
    class FakeSource extends EventTarget {
      onerror: (() => void) | null = null
      onopen: (() => void) | null = null
      readonly url: string
      constructor(url: string) {
        super()
        this.url = url
        sources.push(this)
      }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeSource)
    const seen: ChangeEvent[] = []
    const off = api.onChange((e) => seen.push(e))
    try {
      sources[0].onerror?.()
      sources[0].onopen?.()
      expect(seen).toContainEqual({ kind: 'agentLearning', path: '*', version: null, origin: null })
      expect(seen.map((e) => e.kind)).toEqual([
        'types', 'views', 'ui', 'collections', 'queries', 'automations', 'agents', 'agentChats', 'agentLearning',
        'work', 'workQueue', 'mcpServers', 'settings',
      ])
    } finally {
      off()
    }
  })

  test('fileUrl points at the image route', () => {
    expect(api.fileUrl('Attachments/cover 1.png')).toBe('/api/file?path=Attachments%2Fcover+1.png')
  })
})

describe('mockApi', () => {
  test('mocks every api function with a vi.fn()', async () => {
    const { mockApi } = await import('@/test/mockApi')
    const mocked = mockApi()
    expect(Object.keys(mocked).sort()).toEqual(Object.keys(api).sort())
    for (const fn of Object.values(mocked)) expect(vi.isMockFunction(fn)).toBe(true)
    const custom = mockApi({ trash: async () => [] })
    expect(vi.isMockFunction(custom.trash)).toBe(true)
  })
})
