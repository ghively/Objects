// M11: Settings > Integrations lists, makes and revokes local API tokens.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { MCP_TEXT } from '@/mcp/mcpText'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { mcpConfig } from '@/test/mockApi'
import { INTEGRATIONS_SEARCH, INTEGRATIONS_TEXT as T, IntegrationsSection } from './Integrations'

const mocked = vi.mocked(api)
const TOKEN = { id: 't1', name: 'Claude Code', scope: 'read' as const, createdAt: '2026-11-05T12:00:00.000Z', lastUsedAt: null }

beforeEach(() => {
  vi.clearAllMocks()
  mocked.apiTokens.mockReset()
  mocked.createApiToken.mockReset()
  mocked.revokeApiToken.mockReset()
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
})

describe('Integrations', () => {
  test('test empty list and MCP template', async () => {
    render(<IntegrationsSection />)
    expect(await screen.findByText(T.empty)).toBeInTheDocument()
    expect(screen.getByText(/objectapp-mcp/)).toBeInTheDocument()
  })

  test('test create shows the secret once with a config', async () => {
    const user = userEvent.setup()
    render(<IntegrationsSection />)
    const create = await screen.findByRole('button', { name: T.create })
    expect(create).toBeDisabled()
    await user.type(screen.getByLabelText(T.nameLabel), 'Claude Code')
    await user.click(screen.getByRole('radio', { name: T.readWrite }))
    await user.click(create)
    await waitFor(() => expect(mocked.createApiToken).toHaveBeenCalledWith('Claude Code', 'read-write'))
    expect(await screen.findByTestId('token-secret')).toHaveTextContent('obj_secret')
    expect(screen.getByText(T.created)).toBeInTheDocument()
    expect(mocked.apiTokens).toHaveBeenCalledTimes(2) // the list reloads
    await user.click(screen.getByRole('button', { name: T.done }))
    expect(screen.queryByTestId('token-secret')).toBeNull()
  })

  test('test revoke asks once more first', async () => {
    const user = userEvent.setup()
    mocked.apiTokens.mockResolvedValue({ tokens: [TOKEN], mcp: mcpConfig('<token>') })
    render(<IntegrationsSection />)
    const list = await screen.findByRole('list', { name: T.tokens })
    expect(within(list).getByText('Claude Code')).toBeInTheDocument()
    expect(within(list).getByText(new RegExp(T.never))).toBeInTheDocument()
    await user.click(within(list).getByRole('button', { name: `${T.revoke} Claude Code` }))
    expect(mocked.revokeApiToken).not.toHaveBeenCalled()
    await user.click(within(list).getByRole('button', { name: `${T.revokeConfirm} Claude Code` }))
    await waitFor(() => expect(mocked.revokeApiToken).toHaveBeenCalledWith('t1'))
  })

  test('test a failed create shows the error', async () => {
    const user = userEvent.setup()
    mocked.createApiToken.mockRejectedValue(new Error('A space can have at most 50 tokens.'))
    render(<IntegrationsSection />)
    await user.type(await screen.findByLabelText(T.nameLabel), 'One more')
    await user.click(screen.getByRole('button', { name: T.create }))
    expect(await screen.findByText(/at most 50 tokens/)).toBeInTheDocument()
  })

  test('test the group sits after the API token groups and is hidden while AI features are hidden', async () => {
    const { unmount } = render(<IntegrationsSection />)
    const mcp = await screen.findByRole('region', { name: MCP_TEXT.heading })
    const titles = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))
    expect(titles.indexOf(MCP_TEXT.heading)).toBeGreaterThan(titles.indexOf(T.mcp))
    expect(titles.indexOf(T.mcp)).toBeGreaterThan(titles.indexOf(T.newToken))
    expect(titles.indexOf(T.newToken)).toBeGreaterThan(titles.indexOf(T.tokens))
    expect(titles.indexOf(MCP_TEXT.secretVariables)).toBeGreaterThan(titles.indexOf(MCP_TEXT.heading))
    expect(mcp).toBeInTheDocument()
    unmount()

    useSettings.setState({ settings: { ...settingsDefaults, aiHidden: true }, revision: 'r0', loaded: true })
    render(<IntegrationsSection />)
    expect(await screen.findByText(T.empty)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: MCP_TEXT.heading })).toBeNull()
    expect(screen.queryByRole('region', { name: MCP_TEXT.secretVariables })).toBeNull()
  })

  test('test the search terms include MCP servers', () => {
    expect(INTEGRATIONS_SEARCH).toContain(MCP_TEXT.heading)
    expect(INTEGRATIONS_SEARCH).toContain(MCP_TEXT.secretVariables)
    expect(INTEGRATIONS_SEARCH).toContain('MCP')
  })

  test('test the button reads "New API token"', async () => {
    render(<IntegrationsSection />)
    expect(T.newToken).toBe('New API token')
    expect(await screen.findByRole('heading', { name: 'New API token' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'New token' })).toBeNull()
  })

  test('test developer settings: "Show developer information" is a device setting, last', async () => {
    const user = userEvent.setup()
    render(<IntegrationsSection />)
    await screen.findByText(T.empty)
    const group = screen.getByRole('region', { name: 'Developer settings' })
    expect(within(group).getByRole('heading', { name: 'Developer settings' })).toBeInTheDocument()
    const sw = screen.getByRole('switch', { name: 'Show developer information' })
    expect(sw).not.toBeChecked()
    expect(screen.getByText(T.devInfoHelp)).toBeInTheDocument()
    await user.click(sw)
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ showDeveloperInfo: true }, { baseRevision: 'r0' })
    expect(useSettings.getState().settings.showDeveloperInfo).toBe(true)
    const titles = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))
    expect(titles.indexOf('Developer settings')).toBeGreaterThan(titles.indexOf(MCP_TEXT.heading))
    expect(INTEGRATIONS_SEARCH).toContain('Show developer information')
  })
})
