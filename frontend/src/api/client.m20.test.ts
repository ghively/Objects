// M20 remote agents, the client side: each method calls its route with the Contract's body.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, CLIENT_ID } from './client'

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

function call(fetchMock: ReturnType<typeof respond>, i = 0): { url: string; method: string; body: unknown } {
  const [url, init] = fetchMock.mock.calls[i] as unknown as [string, RequestInit]
  return { url, method: String(init?.method ?? 'GET'), body: init?.body ? JSON.parse(String(init.body)) : null }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('test M20 client', () => {
  test('test the remote agent methods call their routes', async () => {
    const fetchMock = respond(200, { ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const auth = { kind: 'bearer' as const, value: 'tok' }

    await api.previewRemoteAgent('http://127.0.0.1:8799', auth)
    expect(call(fetchMock, 0)).toEqual({
      url: '/api/remote-agents/preview',
      method: 'POST',
      body: { url: 'http://127.0.0.1:8799', auth },
    })

    await api.addRemoteAgent({ url: 'http://127.0.0.1:8799', auth, name: 'Planner' })
    expect(call(fetchMock, 1)).toEqual({
      url: '/api/remote-agents',
      method: 'POST',
      body: { url: 'http://127.0.0.1:8799', auth, name: 'Planner', clientId: CLIENT_ID },
    })

    await api.saveRemoteAgent('01JREMOTE', { name: 'Planner', icon: 'ph-globe', auth: null, baseRevision: 'r1' })
    expect(call(fetchMock, 2)).toEqual({
      url: '/api/remote-agents/01JREMOTE',
      method: 'PUT',
      body: { name: 'Planner', icon: 'ph-globe', auth: null, baseRevision: 'r1', clientId: CLIENT_ID },
    })

    await api.refreshRemoteAgent('01JREMOTE')
    expect(call(fetchMock, 3)).toEqual({
      url: '/api/remote-agents/01JREMOTE/refresh',
      method: 'POST',
      body: { clientId: CLIENT_ID },
    })

    await api.ackRemoteContext('01JREMOTE')
    expect(call(fetchMock, 4)).toEqual({
      url: '/api/remote-agents/01JREMOTE/context-notice',
      method: 'POST',
      body: { clientId: CLIENT_ID },
    })

    await api.revealAgentFile('01JREMOTE', 'chat1/plan.md')
    expect(call(fetchMock, 5)).toEqual({
      url: '/api/agents/01JREMOTE/files/reveal',
      method: 'POST',
      body: { file: 'chat1/plan.md' },
    })
  })

  test('test adding an agent that is already listed keeps the server message', async () => {
    vi.stubGlobal('fetch', respond(409, { detail: 'This agent is already listed as Planner.' }))
    await expect(api.addRemoteAgent({ url: 'http://127.0.0.1:8799', auth: { kind: 'none' } })).rejects.toThrow(
      'This agent is already listed as Planner.',
    )
  })
})
