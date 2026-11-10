// M29 Task 12: Settings > Integrations offers a third scope, "Synced facts only" (`sync`).
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { mcpConfig } from '@/test/mockApi'
import { INTEGRATIONS_TEXT as T, IntegrationsSection } from './Integrations'

const mocked = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
})

describe('Integrations (M29)', () => {
  test('the scope choice offers Synced facts only', async () => {
    render(<IntegrationsSection />)
    const sync = await screen.findByRole('radio', { name: T.sync })
    expect(sync).toBeInTheDocument()
    expect(screen.getByText(T.syncHelp)).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })

  test("creating it posts scope 'sync'", async () => {
    const user = userEvent.setup()
    render(<IntegrationsSection />)
    await user.type(await screen.findByLabelText(T.nameLabel), 'Inventory script')
    await user.click(screen.getByRole('radio', { name: T.sync }))
    await user.click(screen.getByRole('button', { name: T.create }))
    await waitFor(() => expect(mocked.createApiToken).toHaveBeenCalledWith('Inventory script', 'sync'))
  })

  test('the token list labels it Synced facts only', async () => {
    mocked.apiTokens.mockResolvedValue({
      tokens: [
        { id: 't1', name: 'Inventory script', scope: 'sync', createdAt: '2026-11-09T10:00:00.000Z', lastUsedAt: null },
        { id: 't2', name: 'Claude Code', scope: 'read-write', createdAt: '2026-11-09T10:00:00.000Z', lastUsedAt: null },
      ],
      mcp: mcpConfig('<token>'),
    })
    render(<IntegrationsSection />)
    const list = await screen.findByRole('list', { name: T.tokens })
    const [sync, rw] = within(list).getAllByRole('listitem')
    expect(sync).toHaveTextContent(`${T.sync} · ${T.never}`)
    expect(rw).toHaveTextContent(`${T.readWrite} · ${T.never}`)
  })
})
