// M19 T7: Settings > Integrations > MCP servers: the list, the switch, Test and Delete.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, RevisionConflictError } from '@/api/client'
import { mcpServer, mcpTestResult } from '@/test/mockApi'
import { McpServersGroup } from './McpServersGroup'
import { MCP_TEXT as T } from './mcpText'

const mocked = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  mocked.mcpServers.mockReset()
  mocked.mcpServers.mockResolvedValue({ servers: [], readOnlyReason: null, unreadable: false })
  mocked.saveMcpServer.mockReset()
  mocked.testMcpServer.mockReset()
  mocked.deleteMcpServer.mockReset()
  mocked.deleteMcpServer.mockResolvedValue({ ok: true })
  mocked.mcpSecrets.mockResolvedValue([])
})

describe('McpServersGroup', () => {
  test('test the empty list offers Add MCP server', async () => {
    render(<McpServersGroup />)
    expect(await screen.findByText(T.empty)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: T.add })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: T.heading })).toHaveTextContent(T.help)
  })

  test('test a row shows its summary and last test', async () => {
    mocked.mcpServers.mockResolvedValue({
      servers: [
        mcpServer({ id: 's1', name: 'github', lastTest: mcpTestResult() }),
        mcpServer({ id: 's2', name: 'remote', kind: 'url', command: null, args: [], env: [], transport: 'sse', url: 'https://host/path' }),
      ],
      readOnlyReason: null, unreadable: false,
    })
    render(<McpServersGroup />)
    const list = await screen.findByRole('list', { name: T.heading })
    expect(within(list).getByText('npx -y some-mcp-server')).toBeInTheDocument()
    expect(within(list).getByText('3 tools')).toBeInTheDocument()
    expect(within(list).getByText('https://host/path · SSE')).toBeInTheDocument()
  })

  test('test the switch saves enabled and retries once on 409', async () => {
    const user = userEvent.setup()
    const first = mcpServer({ id: 's1', name: 'github', revision: 'r1' })
    mocked.mcpServers
      .mockResolvedValueOnce({ servers: [first], readOnlyReason: null, unreadable: false })
      .mockResolvedValue({ servers: [{ ...first, revision: 'r2' }], readOnlyReason: null, unreadable: false })
    mocked.saveMcpServer
      .mockRejectedValueOnce(new RevisionConflictError('r2'))
      .mockResolvedValue({ ...first, enabled: false, revision: 'r3' })
    render(<McpServersGroup />)
    await user.click(await screen.findByRole('switch', { name: `${T.enabled} github` }))
    await waitFor(() => expect(mocked.saveMcpServer).toHaveBeenCalledTimes(2))
    const [id, input, rev] = mocked.saveMcpServer.mock.calls[0]
    expect(id).toBe('s1')
    expect(rev).toBe('r1')
    expect(input).toMatchObject({ name: 'github', enabled: false, kind: 'command', bearerAction: 'keep' })
    // the stored secret row is kept, never sent
    expect(input.env).toEqual([
      { key: 'LOG_LEVEL', value: 'info', secret: false },
      { key: 'API_KEY', value: null, secret: true },
    ])
    expect(mocked.saveMcpServer.mock.calls[1][2]).toBe('r2')
    expect(mocked.saveMcpServer.mock.calls[1][1]).toMatchObject({ enabled: false })
  })

  test('test Test lists the tools and shows a failure\'s message', async () => {
    const user = userEvent.setup()
    mocked.mcpServers.mockResolvedValue({ servers: [mcpServer({ id: 's1', name: 'github' })], readOnlyReason: null, unreadable: false })
    let finish: (r: ReturnType<typeof mcpTestResult>) => void = () => undefined
    mocked.testMcpServer.mockReturnValueOnce(new Promise((r) => (finish = r)))
    render(<McpServersGroup />)
    await user.click(await screen.findByRole('button', { name: `${T.test} github` }))
    expect(await screen.findByText(T.testing)).toBeInTheDocument()
    finish(mcpTestResult())
    expect(await screen.findByText(T.tools(3))).toBeInTheDocument()
    expect(screen.getByText('echo')).toBeInTheDocument()
    expect(screen.getByText('Echo the text back.')).toBeInTheDocument()
    expect(mocked.testMcpServer).toHaveBeenCalledWith('s1')

    mocked.testMcpServer.mockResolvedValueOnce(mcpTestResult({ ok: false, tools: [], error: "Couldn't connect to host." }))
    await user.click(screen.getByRole('button', { name: `${T.test} github` }))
    expect(await screen.findByText(T.testFailed("Couldn't connect to host."))).toBeInTheDocument()
    expect(screen.queryByText(T.tools(3))).toBeNull()
  })

  test('test Delete asks to confirm', async () => {
    const user = userEvent.setup()
    mocked.mcpServers.mockResolvedValue({ servers: [mcpServer({ id: 's1', name: 'github' })], readOnlyReason: null, unreadable: false })
    render(<McpServersGroup />)
    await user.click(await screen.findByRole('button', { name: `${T.delete} github` }))
    expect(mocked.deleteMcpServer).not.toHaveBeenCalled()
    expect(screen.getByText(T.deleteHelp)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: `${T.confirmDelete} github` }))
    await waitFor(() => expect(mocked.deleteMcpServer).toHaveBeenCalledWith('s1'))
  })

  test('test the list reloads on mcpServers events', async () => {
    let listener: ((e: { kind: string; path: string }) => void) | null = null
    mocked.onChange.mockImplementation((fn) => {
      listener = fn as never
      return () => undefined
    })
    render(<McpServersGroup />)
    await screen.findByText(T.empty)
    const before = mocked.mcpServers.mock.calls.length
    listener!({ kind: 'mcpServers', path: 's1' })
    await waitFor(() => expect(mocked.mcpServers.mock.calls.length).toBeGreaterThan(before))
  })

  test('test a read-only list says why and offers no Add', async () => {
    mocked.mcpServers.mockResolvedValue({ servers: [], readOnlyReason: T.newerVersion, unreadable: false })
    render(<McpServersGroup />)
    expect(await screen.findByText(T.newerVersion)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: T.add })).toBeNull()
  })

  test('test an unreadable file says so and still offers Add', async () => {
    mocked.mcpServers.mockResolvedValue({ servers: [], readOnlyReason: null, unreadable: true })
    render(<McpServersGroup />)
    expect(await screen.findByText(T.unreadable)).toBeInTheDocument()
    expect(screen.queryByText(T.empty)).toBeNull()
    expect(screen.getByRole('button', { name: T.add })).toBeInTheDocument()
  })
})
