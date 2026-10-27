// M8 Task 3: every client method of the contract calls its route with the contract body.
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent } from './types'
import { api, ApiError, CLIENT_ID, ConfirmRequiredError, ConflictError } from './client'

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

type Call = [string, RequestInit | undefined]
const urlOf = (f: ReturnType<typeof vi.fn>, i = 0) => (f.mock.calls[i] as unknown as Call)[0]
const initOf = (f: ReturnType<typeof vi.fn>, i = 0) => (f.mock.calls[i] as unknown as Call)[1]
const methodOf = (f: ReturnType<typeof vi.fn>, i = 0) => initOf(f, i)?.method ?? 'GET'
const bodyOf = (f: ReturnType<typeof vi.fn>, i = 0) => JSON.parse(String(initOf(f, i)?.body)) as Record<string, unknown>

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

const UPDATE = { version: 'v2', frontmatter: {}, links: {}, synced: [], skipped: [] }

afterEach(() => vi.unstubAllGlobals())

describe('test m8 client methods call the contract routes', () => {
  test('overdue', async () => {
    const f = respond(200, { count: 3, capped: false, missed: ['2026-10-24'], current: null, today: '2026-10-27' })
    vi.stubGlobal('fetch', f)
    await expect(api.overdue('Tasks/Water plants.md')).resolves.toMatchObject({ count: 3 })
    expect(methodOf(f)).toBe('GET')
    expect(urlOf(f)).toBe('/api/tasks/overdue?path=Tasks%2FWater%20plants.md')
  })

  test('occurrence', async () => {
    const f = respond(200, UPDATE)
    vi.stubGlobal('fetch', f)
    const seen = await collect(() => api.occurrence('Tasks/A.md', 'skip', { catchUp: 'catchUpThroughNow', baseVersion: 'v1' }))
    expect(methodOf(f)).toBe('POST')
    expect(urlOf(f)).toBe('/api/tasks/occurrence')
    expect(bodyOf(f)).toEqual({ path: 'Tasks/A.md', action: 'skip', catchUp: 'catchUpThroughNow', baseVersion: 'v1', clientId: CLIENT_ID })
    expect(seen).toEqual([{ kind: 'changed', path: 'Tasks/A.md', version: 'v2', origin: CLIENT_ID }])
    // No catchUp: the key is left out.
    vi.stubGlobal('fetch', f)
    await api.occurrence('Tasks/A.md', 'complete', { baseVersion: 'v2' })
    expect(bodyOf(f, 1)).toEqual({ path: 'Tasks/A.md', action: 'complete', baseVersion: 'v2', clientId: CLIENT_ID })
  })

  test('occurrence 409 is a ConflictError', async () => {
    vi.stubGlobal('fetch', respond(409, { detail: { currentVersion: 'v9' } }))
    const err = await api.occurrence('Tasks/A.md', 'excuse', { baseVersion: 'v1' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect((err as ConflictError).currentVersion).toBe('v9')
  })

  test('taskStats', async () => {
    const f = respond(200, { unit: 'day', currentStreak: 1, bestStreak: 2, completions: 3, completionRate: 0.5, atRisk: false, cells: [] })
    vi.stubGlobal('fetch', f)
    await expect(api.taskStats('Tasks/A.md')).resolves.toMatchObject({ bestStreak: 2 })
    expect(methodOf(f)).toBe('GET')
    expect(urlOf(f)).toBe('/api/tasks/stats?path=Tasks%2FA.md')
  })

  test('setReminder', async () => {
    const f = respond(200, UPDATE)
    vi.stubGlobal('fetch', f)
    const seen = await collect(() => api.setReminder('Tasks/Submit report.md', 'deadline', '1 day before at 09:00', { baseVersion: 'v1' }))
    expect(methodOf(f)).toBe('PUT')
    expect(urlOf(f)).toBe('/api/tasks/reminder')
    expect(bodyOf(f)).toEqual({
      path: 'Tasks/Submit report.md',
      key: 'deadline',
      remind: '1 day before at 09:00',
      baseVersion: 'v1',
      clientId: CLIENT_ID,
    })
    expect(seen.map((e) => e.path)).toEqual(['Tasks/Submit report.md'])
    await api.setReminder('Tasks/Submit report.md', 'deadline', null, { baseVersion: 'v2' })
    expect(bodyOf(f, 1).remind).toBeNull()
  })

  test('block and blockReferences', async () => {
    const f = respond(200, { path: 'Pages/Source note.md', id: 'ab12cd', markdown: 'x ^ab12cd', version: 'v1' })
    vi.stubGlobal('fetch', f)
    await expect(api.block('Pages/Source note.md', 'ab12cd')).resolves.toMatchObject({ id: 'ab12cd' })
    expect(methodOf(f)).toBe('GET')
    expect(urlOf(f)).toBe('/api/block?path=Pages%2FSource%20note.md&id=ab12cd')
    const g = respond(200, { paths: ['Pages/Blocks M8.md'] })
    vi.stubGlobal('fetch', g)
    await expect(api.blockReferences('Pages/Source note.md', 'ab12cd')).resolves.toEqual({ paths: ['Pages/Blocks M8.md'] })
    expect(urlOf(g)).toBe('/api/block/references?path=Pages%2FSource%20note.md&id=ab12cd')
  })

  test('history, historyVersion and restoreVersion', async () => {
    const versions = [{ id: 'v-2', number: 2, at: '2026-10-27T10:00:00Z', size: 10, kind: 'object', title: 'A' }]
    const f = respond(200, { versions })
    vi.stubGlobal('fetch', f)
    await expect(api.history('Pages/A.md')).resolves.toEqual(versions)
    expect(methodOf(f)).toBe('GET')
    expect(urlOf(f)).toBe('/api/history?path=Pages%2FA.md')

    const g = respond(200, { id: 'v-2', text: 'body' })
    vi.stubGlobal('fetch', g)
    await expect(api.historyVersion('Pages/A.md', 'v-2')).resolves.toEqual({ id: 'v-2', text: 'body' })
    expect(urlOf(g)).toBe('/api/history/version?path=Pages%2FA.md&id=v-2')

    const h = respond(200, { version: 'v5' })
    vi.stubGlobal('fetch', h)
    const seen = await collect(() => api.restoreVersion('Pages/A.md', 'v-2', { baseVersion: 'v4' }))
    expect(methodOf(h)).toBe('POST')
    expect(urlOf(h)).toBe('/api/history/restore')
    expect(bodyOf(h)).toEqual({ path: 'Pages/A.md', id: 'v-2', baseVersion: 'v4', clientId: CLIENT_ID })
    expect(seen).toEqual([{ kind: 'changed', path: 'Pages/A.md', version: 'v5', origin: CLIENT_ID }])
  })

  test('mergeObject', async () => {
    const f = respond(200, {
      target: 'Pages/Merge target.md',
      version: 't2',
      relinked: ['Pages/Refers to source.md'],
      skipped: [],
      dropped: [],
      trashId: 'trash-1',
    })
    vi.stubGlobal('fetch', f)
    const seen = await collect(() =>
      api.mergeObject('Pages/Merge source.md', 'Pages/Merge target.md', { sourceVersion: 's1', targetVersion: 't1' }),
    )
    expect(methodOf(f)).toBe('POST')
    expect(urlOf(f)).toBe('/api/object/merge')
    expect(bodyOf(f)).toEqual({
      source: 'Pages/Merge source.md',
      target: 'Pages/Merge target.md',
      sourceVersion: 's1',
      targetVersion: 't1',
      confirm: true,
      clientId: CLIENT_ID,
    })
    expect(seen).toEqual([
      { kind: 'changed', path: 'Pages/Merge target.md', version: 't2', origin: CLIENT_ID },
      { kind: 'changed', path: 'Pages/Refers to source.md', version: null, origin: CLIENT_ID },
      { kind: 'deleted', path: 'Pages/Merge source.md', version: null, origin: CLIENT_ID },
    ])
  })

  test('deleteSpace', async () => {
    const f = respond(200, { trashed: true })
    vi.stubGlobal('fetch', f)
    await expect(api.deleteSpace('/spaces/Old')).resolves.toEqual({ trashed: true })
    expect(methodOf(f)).toBe('POST')
    expect(urlOf(f)).toBe('/api/spaces/delete')
    expect(bodyOf(f)).toEqual({ path: '/spaces/Old' })
    await api.deleteSpace('/spaces/Old', { permanent: true })
    expect(bodyOf(f, 1)).toEqual({ path: '/spaces/Old', permanent: true })

    vi.stubGlobal('fetch', respond(428, { detail: 'The trash is unavailable' }))
    await expect(api.deleteSpace('/spaces/Old')).rejects.toBeInstanceOf(ConfirmRequiredError)
    vi.stubGlobal('fetch', respond(409, { detail: 'This is the current space' }))
    const err = await api.deleteSpace('/spaces/Current').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).not.toBeInstanceOf(ConflictError)
    expect((err as ApiError).message).toBe('This is the current space')
  })

  test('createSpace and search gain their options', async () => {
    const f = respond(200, { path: '/spaces/New' })
    vi.stubGlobal('fetch', f)
    await api.createSpace('New', '/spaces', 'basic')
    expect(urlOf(f)).toBe('/api/spaces')
    expect(bodyOf(f)).toEqual({ name: 'New', location: '/spaces', setup: 'basic' })
    await api.createSpace('New', '/spaces')
    expect(bodyOf(f, 1)).toEqual({ name: 'New', location: '/spaces' })

    const g = respond(200, { results: [], partial: false })
    vi.stubGlobal('fetch', g)
    await api.search('milk', { mode: 'fullText' })
    expect(urlOf(g)).toBe('/api/search?q=milk&mode=fullText')
  })
})
