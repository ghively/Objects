// M24 Task 1: the work agent's contract on the front end: the client calls, the types and the mocks.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, CLIENT_ID } from '@/api/client'
import type { ChangeKind, DeviceSettings } from '@/api/types'
import { settingsDefaults } from '@/settings/defaults'
import { captureItem, deskSyncStatus, workAgentSettings } from '@/test/mockApi'

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}
function lastCall(fetchMock: ReturnType<typeof respond>) {
  const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit | undefined]
  return { url, init }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('test M24 contract', () => {
  test('workAgentSettings gets the settings route', async () => {
    const fetchMock = respond(200, workAgentSettings())
    vi.stubGlobal('fetch', fetchMock)
    await api.workAgentSettings()
    expect(lastCall(fetchMock).url).toBe('/api/work/agent-settings')
  })

  test('saveWorkAgentSettings puts the patch with its revision', async () => {
    const fetchMock = respond(200, workAgentSettings())
    vi.stubGlobal('fetch', fetchMock)
    await api.saveWorkAgentSettings({ acts: true }, 'r1')
    const { url, init } = lastCall(fetchMock)
    expect(url).toBe('/api/work/agent-settings')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({ acts: true, baseRevision: 'r1', clientId: CLIENT_ID })
  })

  test('replyCapture posts to the reply route', async () => {
    const fetchMock = respond(200, { capture: captureItem() })
    vi.stubGlobal('fetch', fetchMock)
    await api.replyCapture('Captures/x.md', 'v1', 't')
    const { url, init } = lastCall(fetchMock)
    expect(url).toBe('/api/work/captures/reply')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ path: 'Captures/x.md', version: 'v1', text: 't', clientId: CLIENT_ID })
  })

  test('captureItems gets the captures route with its status', async () => {
    const fetchMock = respond(200, { captures: [captureItem({ status: 'needsYou' })] })
    vi.stubGlobal('fetch', fetchMock)
    const items = await api.captureItems('needsYou')
    expect(lastCall(fetchMock).url).toBe('/api/work/captures?status=needsYou')
    expect(items[0].route).toBe('file')
  })

  test('the other calls use their routes', async () => {
    const fetchMock = respond(200, deskSyncStatus())
    vi.stubGlobal('fetch', fetchMock)
    await api.deskSync()
    expect(lastCall(fetchMock).url).toBe('/api/work/desk-sync')
    await api.setUpDeskSync()
    expect(lastCall(fetchMock).url).toBe('/api/work/desk-sync/setup')
    await api.markCaptureFiled('Captures/x.md', 'v1')
    expect(lastCall(fetchMock).url).toBe('/api/work/captures/mark-filed')
    await api.workAgentCreateInfo()
    expect(lastCall(fetchMock).url).toBe('/api/work/agent/create-info')
    await api.createWorkAgent(true)
    expect(lastCall(fetchMock).url).toBe('/api/work/agent/create')
    await api.workReadTools()
    expect(lastCall(fetchMock).url).toBe('/api/work/read-tools')
  })

  test('types: workQueue is a change kind; the device settings gain the four keys', () => {
    const kind = 'workQueue' satisfies ChangeKind
    expect(kind).toBe('workQueue')
    const s: Pick<DeviceSettings, 'workAgentId' | 'workAgentActs' | 'workAutoRun' | 'workReadTools'> = settingsDefaults
    expect(s).toMatchObject({ workAgentId: null, workAgentActs: false, workAutoRun: true, workReadTools: [] })
  })
})
