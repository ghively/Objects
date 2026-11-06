// M19 T7: Settings > Integrations > Secret variables.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { secretVar } from '@/test/mockApi'
import { SecretVariables } from './SecretVariables'
import { MCP_TEXT as T } from './mcpText'

const mocked = vi.mocked(api)
const USE = { agentId: 'a1', agentName: 'Researcher', server: 'github' }

beforeEach(() => {
  vi.clearAllMocks()
  mocked.mcpSecrets.mockReset()
  mocked.mcpSecrets.mockResolvedValue([])
  mocked.onChange.mockImplementation(() => () => undefined)
})

describe('SecretVariables', () => {
  test('test secret variables list Missing ones with who uses them and Set… saves', async () => {
    const user = userEvent.setup()
    mocked.mcpSecrets
      .mockResolvedValueOnce([secretVar({ name: 'GH_TOKEN', usedBy: [USE] }), secretVar({ name: 'OTHER', set: true })])
      .mockResolvedValue([secretVar({ name: 'GH_TOKEN', set: true, usedBy: [USE] }), secretVar({ name: 'OTHER', set: true })])
    render(<SecretVariables />)
    const section = await screen.findByRole('region', { name: T.secretVariables })
    expect(section).toHaveTextContent(T.secretVariablesHelp)
    const row = (await within(section).findByText('GH_TOKEN')).closest('li')!
    expect(within(row).getByText(T.varMissing)).toBeInTheDocument()
    expect(within(row).getByText('Used by Researcher (github)')).toBeInTheDocument()
    const other = within(section).getByText('OTHER').closest('li')!
    expect(within(other).getByText(T.varSet)).toBeInTheDocument()
    expect(within(other).getByRole('button', { name: `${T.replaceVar} OTHER` })).toBeInTheDocument()

    await user.click(within(row).getByRole('button', { name: `${T.setVar} GH_TOKEN` }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: T.setTitle('GH_TOKEN') })).toBeInTheDocument()
    const value = within(dialog).getByLabelText(T.value)
    expect(value).toHaveAttribute('type', 'password')
    expect(value).toHaveAttribute('autocomplete', 'off')
    await user.type(value, 's3cret-var')
    await user.click(within(dialog).getByRole('button', { name: T.save }))
    await waitFor(() => expect(mocked.setMcpSecret).toHaveBeenCalledWith('GH_TOKEN', 's3cret-var'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.body.innerHTML).not.toContain('s3cret-var')
    await waitFor(() => expect(within(screen.getByText('GH_TOKEN').closest('li')!).getByText(T.varSet)).toBeInTheDocument())
  })

  test("test a variable Object can't set shows the environment note and no Set…", async () => {
    mocked.mcpSecrets.mockResolvedValue([secretVar({ name: 'HOME', settable: false, usedBy: [USE] })])
    render(<SecretVariables />)
    const row = (await screen.findByText('HOME')).closest('li')!
    expect(within(row).getByText(T.fromEnvironment)).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: `${T.setVar} HOME` })).toBeNull()
    expect(within(row).queryByRole('button', { name: `${T.replaceVar} HOME` })).toBeNull()
  })

  test('test Delete removes a set variable', async () => {
    const user = userEvent.setup()
    mocked.mcpSecrets.mockResolvedValue([secretVar({ name: 'GH_TOKEN', set: true })])
    render(<SecretVariables />)
    await user.click(await screen.findByRole('button', { name: `${T.deleteVar} GH_TOKEN` }))
    await waitFor(() => expect(mocked.deleteMcpSecret).toHaveBeenCalledWith('GH_TOKEN'))
  })

  test('test the list reloads on mcpServers and agents events', async () => {
    let listener: ((e: { kind: string; path: string }) => void) | null = null
    mocked.onChange.mockImplementation((fn) => {
      listener = fn as never
      return () => undefined
    })
    render(<SecretVariables />)
    await waitFor(() => expect(mocked.mcpSecrets).toHaveBeenCalledTimes(1))
    listener!({ kind: 'agents', path: 'secrets' })
    await waitFor(() => expect(mocked.mcpSecrets).toHaveBeenCalledTimes(2))
    listener!({ kind: 'mcpServers', path: 'secrets' })
    await waitFor(() => expect(mocked.mcpSecrets).toHaveBeenCalledTimes(3))
    listener!({ kind: 'changed', path: 'x.md' })
    await new Promise((r) => setTimeout(r, 20))
    expect(mocked.mcpSecrets).toHaveBeenCalledTimes(3)
  })
})
