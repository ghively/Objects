// M19 T7: the Add / Edit MCP server dialog.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError } from '@/api/client'
import type { McpServer } from '@/api/types'
import { mcpServer } from '@/test/mockApi'
import { McpServerDialog } from './McpServerDialog'
import { MCP_TEXT as T } from './mcpText'

const mocked = vi.mocked(api)

function Harness({ server, onSaved = () => undefined }: { server?: McpServer | null; onSaved?(s: McpServer): void }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        reopen
      </button>
      <McpServerDialog open={open} onOpenChange={setOpen} server={server} onSaved={onSaved} />
    </>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('McpServerDialog', () => {
  test('test Add MCP server by command sends the rows with secret flags', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(<Harness onSaved={onSaved} />)
    expect(screen.getByRole('heading', { name: T.addTitle })).toBeInTheDocument()
    await user.type(screen.getByLabelText(T.name), 'github')
    await user.type(screen.getByRole('textbox', { name: T.command }), 'npx')
    await user.type(screen.getByLabelText(T.arguments), '-y{Enter}some-mcp-server{Enter}')
    await user.click(screen.getByRole('button', { name: `${T.addRow}: ${T.environment}` }))
    // a new row's Secret checkbox is on
    expect(screen.getByRole('checkbox', { name: `${T.environment} ${T.secret} 1` })).toBeChecked()
    await user.type(screen.getByLabelText(`${T.environment} ${T.rowName} 1`), 'API_KEY')
    await user.type(screen.getByLabelText(`${T.environment} ${T.rowValue} 1`), 's3cret-typed')
    await user.click(screen.getByRole('button', { name: `${T.addRow}: ${T.environment}` }))
    await user.type(screen.getByLabelText(`${T.environment} ${T.rowName} 2`), 'LOG_LEVEL')
    await user.type(screen.getByLabelText(`${T.environment} ${T.rowValue} 2`), 'info')
    await user.click(screen.getByRole('checkbox', { name: `${T.environment} ${T.secret} 2` }))
    await user.click(screen.getByRole('button', { name: T.save }))
    await waitFor(() => expect(mocked.createMcpServer).toHaveBeenCalledTimes(1))
    expect(mocked.createMcpServer.mock.calls[0][0]).toEqual({
      name: 'github',
      enabled: true,
      kind: 'command',
      command: 'npx',
      args: ['-y', 'some-mcp-server'],
      env: [
        { key: 'API_KEY', value: 's3cret-typed', secret: true },
        { key: 'LOG_LEVEL', value: 'info', secret: false },
      ],
      transport: null,
      url: null,
      headers: [],
      bearer: null,
      bearerAction: 'keep',
    })
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('test a row can be removed', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: `${T.addRow}: ${T.environment}` }))
    expect(screen.getByLabelText(`${T.environment} ${T.rowName} 1`)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: `${T.removeRow} ${T.environment} 1` }))
    expect(screen.queryByLabelText(`${T.environment} ${T.rowName} 1`)).toBeNull()
  })

  test('test Add by URL sends transport, headers and a bearer with bearerAction set', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByLabelText(T.name), 'remote')
    await user.click(screen.getByRole('radio', { name: T.byUrl }))
    expect(screen.queryByRole('textbox', { name: T.command })).toBeNull()
    await user.type(screen.getByRole('textbox', { name: T.url }), 'https://host/mcp')
    await user.click(screen.getByRole('radio', { name: T.transportSse }))
    await user.click(screen.getByRole('button', { name: `${T.addRow}: ${T.headers}` }))
    expect(screen.getByRole('checkbox', { name: `${T.headers} ${T.secret} 1` })).toBeChecked()
    await user.type(screen.getByLabelText(`${T.headers} ${T.rowName} 1`), 'X-Api-Key')
    await user.type(screen.getByLabelText(`${T.headers} ${T.rowValue} 1`), 's3cret-header')
    const bearer = screen.getByLabelText(T.bearer)
    expect(bearer).toHaveAttribute('type', 'password')
    await user.type(bearer, 's3cret-bearer')
    await user.click(screen.getByRole('button', { name: T.save }))
    await waitFor(() => expect(mocked.createMcpServer).toHaveBeenCalledTimes(1))
    expect(mocked.createMcpServer.mock.calls[0][0]).toEqual({
      name: 'remote',
      enabled: true,
      kind: 'url',
      command: null,
      args: [],
      env: [],
      transport: 'sse',
      url: 'https://host/mcp',
      headers: [{ name: 'X-Api-Key', value: 's3cret-header', secret: true }],
      bearer: 's3cret-bearer',
      bearerAction: 'set',
    })
  })

  test('test editing shows saved secrets masked and keeps them unless replaced', async () => {
    const user = userEvent.setup()
    const server = mcpServer({ id: 's1', name: 'github', revision: 'r1' })
    render(<Harness server={server} />)
    expect(screen.getByRole('heading', { name: T.editTitle })).toBeInTheDocument()
    expect(screen.getByText(T.savedSecret)).toBeInTheDocument()
    expect(screen.getByLabelText(`${T.environment} ${T.rowValue} 1`)).toHaveValue('info')
    await user.click(screen.getByRole('button', { name: T.save }))
    await waitFor(() => expect(mocked.saveMcpServer).toHaveBeenCalledTimes(1))
    const [id, input, rev] = mocked.saveMcpServer.mock.calls[0]
    expect([id, rev]).toEqual(['s1', 'r1'])
    expect(input.env).toEqual([
      { key: 'LOG_LEVEL', value: 'info', secret: false },
      { key: 'API_KEY', value: null, secret: true },
    ])

    // replace it, type a value, then cancel: the reopened dialog holds no typed secret
    await user.click(screen.getByRole('button', { name: 'reopen' }))
    await user.click(screen.getByRole('button', { name: `${T.replace} ${T.environment} 2` }))
    await user.type(screen.getByLabelText(`${T.environment} ${T.rowValue} 2`), 's3cret-typed')
    await user.click(screen.getByRole('button', { name: T.cancel }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'reopen' }))
    expect(screen.getByText(T.savedSecret)).toBeInTheDocument()
    for (const el of screen.getAllByRole('textbox')) expect(el).not.toHaveValue('s3cret-typed')
    expect(document.body.innerHTML).not.toContain('s3cret-typed')
  })

  test('test an empty replacement keeps the secret and a typed one sends it', async () => {
    const user = userEvent.setup()
    const server = mcpServer({ id: 's1', name: 'github', revision: 'r1' })
    render(<Harness server={server} />)
    await user.click(screen.getByRole('button', { name: `${T.replace} ${T.environment} 2` }))
    await user.click(screen.getByRole('button', { name: T.save }))
    await waitFor(() => expect(mocked.saveMcpServer).toHaveBeenCalledTimes(1))
    expect(mocked.saveMcpServer.mock.calls[0][1].env?.[1]).toEqual({ key: 'API_KEY', value: null, secret: true })
    await user.click(screen.getByRole('button', { name: 'reopen' }))
    await user.click(screen.getByRole('button', { name: `${T.replace} ${T.environment} 2` }))
    await user.type(screen.getByLabelText(`${T.environment} ${T.rowValue} 2`), 'new-value')
    await user.click(screen.getByRole('button', { name: T.save }))
    await waitFor(() => expect(mocked.saveMcpServer).toHaveBeenCalledTimes(2))
    expect(mocked.saveMcpServer.mock.calls[1][1].env?.[1]).toEqual({ key: 'API_KEY', value: 'new-value', secret: true })
  })

  test('test a saved bearer keeps, replaces or removes', async () => {
    const user = userEvent.setup()
    const server = mcpServer({
      id: 's2',
      name: 'remote',
      kind: 'url',
      command: null,
      args: [],
      env: [],
      transport: 'http',
      url: 'https://host/mcp',
      bearer: true,
    })
    render(<Harness server={server} />)
    expect(screen.queryByLabelText(T.bearer)).toBeNull()
    await user.click(screen.getByRole('button', { name: T.save }))
    await waitFor(() => expect(mocked.saveMcpServer).toHaveBeenCalledTimes(1))
    expect(mocked.saveMcpServer.mock.calls[0][1]).toMatchObject({ bearer: null, bearerAction: 'keep' })
    await user.click(screen.getByRole('button', { name: 'reopen' }))
    await user.click(screen.getByRole('button', { name: `${T.remove} ${T.bearer}` }))
    await user.click(screen.getByRole('button', { name: T.save }))
    await waitFor(() => expect(mocked.saveMcpServer).toHaveBeenCalledTimes(2))
    expect(mocked.saveMcpServer.mock.calls[1][1]).toMatchObject({ bearer: null, bearerAction: 'remove' })
    await user.click(screen.getByRole('button', { name: 'reopen' }))
    await user.click(screen.getByRole('button', { name: `${T.replace} ${T.bearer}` }))
    await user.type(screen.getByLabelText(T.bearer), 'tok-2')
    await user.click(screen.getByRole('button', { name: T.save }))
    await waitFor(() => expect(mocked.saveMcpServer).toHaveBeenCalledTimes(3))
    expect(mocked.saveMcpServer.mock.calls[2][1]).toMatchObject({ bearer: 'tok-2', bearerAction: 'set' })
  })

  test('test the name is read-only when editing', async () => {
    render(<Harness server={mcpServer({ id: 's1', name: 'github' })} />)
    const name = screen.getByLabelText(T.name)
    expect(name).toHaveValue('github')
    expect(name).toHaveAttribute('readonly')
    expect(screen.getByText(T.nameFixed)).toBeInTheDocument()
  })

  test('test a 422 shows its detail', async () => {
    const user = userEvent.setup()
    mocked.createMcpServer.mockRejectedValueOnce(new ApiError(422, 'Use 1-64 letters, digits, - or _.'))
    render(<Harness />)
    await user.type(screen.getByLabelText(T.name), 'my server')
    await user.type(screen.getByRole('textbox', { name: T.command }), 'npx')
    await user.click(screen.getByRole('button', { name: T.save }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Use 1-64 letters, digits, - or _.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('test a 409 name clash shows its detail', async () => {
    const user = userEvent.setup()
    mocked.createMcpServer.mockRejectedValueOnce(new ApiError(409, 'Another server already has this name.'))
    render(<Harness />)
    await user.type(screen.getByLabelText(T.name), 'GitHub')
    await user.type(screen.getByRole('textbox', { name: T.command }), 'npx')
    await user.click(screen.getByRole('button', { name: T.save }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Another server already has this name.')
  })
})
