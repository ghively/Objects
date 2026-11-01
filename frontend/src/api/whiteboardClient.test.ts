import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, ApiError, CLIENT_ID, ConflictError, ReadOnlyError, RevisionConflictError } from './client'
import { settingsOf, whiteboardApi } from './whiteboardClient'
import type { ChangeEvent } from './types'
import type { WhiteboardData } from './whiteboardTypes'
import { onLocalSave, type LocalSave } from '@/whiteboard/localSaves'

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

function callOf(fetchMock: ReturnType<typeof vi.fn>, call = 0): [string, RequestInit | undefined] {
  return fetchMock.mock.calls[call] as unknown as [string, RequestInit | undefined]
}

const BOARD: WhiteboardData = { version: 1, nodes: {}, edges: {}, blocks: {}, 'x-future': 1 }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('whiteboard client', () => {
  test('test board reads with the path and writes nothing', async () => {
    const fetchMock = respond(200, { path: 'Whiteboards/Net map.md', board: BOARD, revision: '' })
    vi.stubGlobal('fetch', fetchMock)
    const res = await whiteboardApi.board('Whiteboards/Net map.md')
    expect(res.revision).toBe('')
    expect(res.board['x-future']).toBe(1)
    const [url, init] = callOf(fetchMock)
    expect(url).toBe('/api/whiteboard?path=Whiteboards%2FNet%20map.md')
    expect(init?.method ?? 'GET').toBe('GET')
  })

  test('test client sends clientId and maps 409 to a ConflictError with currentRevision', async () => {
    const ok = respond(200, { revision: 'r2' })
    vi.stubGlobal('fetch', ok)
    await expect(whiteboardApi.saveBoard('Whiteboards/A.md', BOARD, 'r1')).resolves.toEqual({ revision: 'r2' })
    const [url, init] = callOf(ok)
    expect(url).toBe('/api/whiteboard')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({ path: 'Whiteboards/A.md', board: BOARD, baseRevision: 'r1', clientId: CLIENT_ID })

    vi.stubGlobal('fetch', respond(409, { currentRevision: 'r9' }))
    const err = await whiteboardApi.saveBoard('Whiteboards/A.md', BOARD, 'r1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RevisionConflictError)
    expect(err).toBeInstanceOf(ConflictError)
    expect((err as RevisionConflictError).currentRevision).toBe('r9')

    // FastAPI's {detail: {...}} wrapping is accepted too.
    vi.stubGlobal('fetch', respond(409, { detail: { currentRevision: 'r10' } }))
    const wrapped = await whiteboardApi.saveBoard('Whiteboards/A.md', BOARD, 'r1').catch((e: unknown) => e)
    expect((wrapped as RevisionConflictError).currentRevision).toBe('r10')

    vi.stubGlobal('fetch', respond(423, { reason: 'newer version' }))
    const ro = await whiteboardApi.saveBoard('Whiteboards/A.md', BOARD, 'r1').catch((e: unknown) => e)
    expect(ro).toBeInstanceOf(ReadOnlyError)
    expect((ro as ReadOnlyError).reason).toBe('newer version')

    vi.stubGlobal('fetch', respond(422, { detail: 'nodes.a.kind is not a node kind' }))
    const bad = await whiteboardApi.saveBoard('Whiteboards/A.md', BOARD, 'r1').catch((e: unknown) => e)
    expect(bad).toBeInstanceOf(ApiError)
    expect((bad as ApiError).status).toBe(422)
    expect((bad as ApiError).message).toBe('nodes.a.kind is not a node kind')
  })

  test('test create whiteboard posts the title with clientId', async () => {
    const fetchMock = respond(201, { path: 'Whiteboards/Plan.md', version: 'v1', typeIds: ['whiteboard'] })
    vi.stubGlobal('fetch', fetchMock)
    const res = await whiteboardApi.createWhiteboard('Plan')
    expect(res.typeIds).toEqual(['whiteboard'])
    const [url, init] = callOf(fetchMock)
    expect(url).toBe('/api/whiteboards')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ title: 'Plan', clientId: CLIENT_ID })
    await whiteboardApi.createWhiteboard()
    expect(JSON.parse(String(callOf(fetchMock, 1)[1]?.body))).toEqual({ clientId: CLIENT_ID })
  })

  test('test settings read ui.whiteboard with defaults absent and save through PUT /api/ui', async () => {
    const get = respond(200, { ui: { pinned: [], whiteboard: { isShowingDots: false, junk: 1 } }, revision: 'u1' })
    vi.stubGlobal('fetch', get)
    await expect(whiteboardApi.settings()).resolves.toEqual({ settings: { isShowingDots: false }, revision: 'u1' })
    expect(callOf(get)[0]).toBe('/api/ui')

    vi.stubGlobal('fetch', respond(200, { ui: { pinned: [] }, revision: 'u1' }))
    await expect(whiteboardApi.settings()).resolves.toEqual({ settings: {}, revision: 'u1' })

    const put = respond(200, { ui: { whiteboard: { isEngineeringMode: true } }, revision: 'u2' })
    vi.stubGlobal('fetch', put)
    await expect(whiteboardApi.saveSettings({ isEngineeringMode: true }, 'u1')).resolves.toEqual({
      settings: { isEngineeringMode: true },
      revision: 'u2',
    })
    const [url, init] = callOf(put)
    expect(url).toBe('/api/ui')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({
      patch: { whiteboard: { isEngineeringMode: true } },
      baseRevision: 'u1',
      clientId: CLIENT_ID,
    })

    vi.stubGlobal('fetch', respond(409, { currentRevision: 'u3' }))
    const err = await whiteboardApi.saveSettings({}, 'u1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect((err as RevisionConflictError).currentRevision).toBe('u3')
  })

  test('test settingsOf keeps only the five boolean keys', () => {
    expect(settingsOf(null)).toEqual({})
    expect(settingsOf('x')).toEqual({})
    expect(
      settingsOf({
        isSnappingToGrid: false,
        isSnappingToNodes: true,
        isShowingDots: 'no',
        isZoomingOnScroll: false,
        isEngineeringMode: true,
        other: true,
      }),
    ).toEqual({ isSnappingToGrid: false, isSnappingToNodes: true, isZoomingOnScroll: false, isEngineeringMode: true })
  })

  test('test a board save is announced to the other views of the board in this window', async () => {
    // "Add to whiteboard" and "Turn into whiteboard" save through the client, not a board hook; the
    // server's event for the save carries our CLIENT_ID and is dropped as an echo, so the open view
    // of the board hears of it only through this announcement.
    await new Promise((r) => setTimeout(r, 0)) // the earlier tests' saves have announced by now
    const seen: LocalSave[] = []
    const off = onLocalSave((e) => seen.push(e))
    try {
      vi.stubGlobal('fetch', respond(200, { revision: 'r2' }))
      await whiteboardApi.saveBoard('Whiteboards/A.md', BOARD, 'r1')
      await new Promise((r) => setTimeout(r, 0))
    } finally {
      off()
    }
    expect(seen.map((e) => [e.path, e.version])).toEqual([['Whiteboards/A.md', 'r2']])
    expect(seen[0].source).toBe(whiteboardApi)
  })

  test('test a settings save announces a local ui event, as every other ui.json write', async () => {
    vi.stubGlobal('EventSource', class extends EventTarget { close() {} })
    const seen: ChangeEvent[] = []
    const off = api.onChange((e) => seen.push(e))
    try {
      vi.stubGlobal('fetch', respond(200, { ui: { whiteboard: { isShowingDots: false } }, revision: 'u2' }))
      await whiteboardApi.saveSettings({ isShowingDots: false }, 'u1')
      await new Promise((r) => setTimeout(r, 0))
    } finally {
      off()
    }
    expect(seen.map((e) => [e.kind, e.path, e.version, e.origin])).toEqual([['ui', 'ui.json', 'u2', CLIENT_ID]])
  })

  test('test a board save that stamped the .md announces changed to this window', async () => {
    vi.stubGlobal('EventSource', class extends EventTarget { close() {} })
    const seen: ChangeEvent[] = []
    const off = api.onChange((e) => seen.push(e))
    try {
      vi.stubGlobal('fetch', respond(200, { revision: 'r2', mdVersion: 'v2', mdBaseVersion: 'v1' }))
      await whiteboardApi.saveBoard('Whiteboards/A.md', BOARD, 'r1')
      vi.stubGlobal('fetch', respond(200, { revision: 'r3' }))
      await whiteboardApi.saveBoard('Whiteboards/B.md', BOARD, 'r2')
      await new Promise((r) => setTimeout(r, 0))
    } finally {
      off()
    }
    expect(seen.map((e) => [e.kind, e.path, e.version])).toEqual([['changed', 'Whiteboards/A.md', 'v2']])
  })
})
