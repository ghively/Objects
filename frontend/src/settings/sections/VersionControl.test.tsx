import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VcsStatus } from '@/api/vcsClient'

vi.mock('@/api/vcsClient', () => ({
  vcsApi: {
    status: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    commit: vi.fn(),
    push: vi.fn(),
    pull: vi.fn(),
    setRemote: vi.fn(),
    setAutoPush: vi.fn(),
    setSettings: vi.fn(),
    enableAll: vi.fn(),
  },
}))

import { vcsApi } from '@/api/vcsClient'
import { useTabs } from '@/nav/tabs'
import { useVcsStatus } from '@/vcs/useVcsStatus'
import { VersionControlSection } from './VersionControl'

const api = vi.mocked(vcsApi)

const OFF: VcsStatus = { target: 'space', gitAvailable: true, enabled: false, repository: false, root: '/s' }
const ON: VcsStatus = {
  target: 'space',
  gitAvailable: true,
  enabled: true,
  repository: true,
  root: '/s',
  branch: 'main',
  lastCommit: { sha: 'a'.repeat(40), short: 'aaaaaaa', at: '2026-11-08T10:00:00Z', message: 'Object: edit 1 object (Printer jams)' },
  pending: 2,
  remote: null,
  remotes: {},
  error: null,
  warning: null,
  settings: { commitDelaySeconds: 120, pushDelaySeconds: 600 },
}

beforeEach(() => {
  useVcsStatus.setState({ space: null })
  for (const fn of Object.values(api)) fn.mockReset()
})
afterEach(() => vi.clearAllMocks())

describe('Settings > Version control', () => {
  it('offers to turn it on and turns it on', async () => {
    api.status.mockResolvedValue(OFF)
    api.enable.mockResolvedValue(ON)
    const user = userEvent.setup()
    render(<VersionControlSection />)
    const button = await screen.findByRole('button', { name: 'Turn on version control' })
    await user.click(button)
    expect(api.enable).toHaveBeenCalledWith('space')
    expect(await screen.findByText('Object: edit 1 object (Printer jams)', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('2 changes waiting to be committed')).toBeInTheDocument()
    expect(screen.getByText('No remote set')).toBeInTheDocument()
  })

  it('says git is not installed', async () => {
    api.status.mockResolvedValue({ ...OFF, gitAvailable: false })
    render(<VersionControlSection />)
    expect(await screen.findByText('Git is not installed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Turn on version control' })).not.toBeInTheDocument()
  })

  it('commits now, saves a remote and opens Space history', async () => {
    api.status.mockResolvedValue(ON)
    api.commit.mockResolvedValue({ commit: 'b'.repeat(40), status: { ...ON, pending: 0 } })
    const withRemote: VcsStatus = {
      ...ON,
      pending: 0,
      remote: {
        name: 'origin', url: 'git@lab:gene/notes.git', branch: 'main', autoPush: true, ahead: 1, behind: 0,
        diverged: false, neverPushed: false, lastPush: null, lastFetch: null, blocked: null,
      },
    }
    api.setRemote.mockResolvedValue(withRemote)
    const user = userEvent.setup()
    render(<VersionControlSection />)
    await user.click(await screen.findByRole('button', { name: 'Commit now' }))
    expect(api.commit).toHaveBeenCalledWith('space')
    expect(await screen.findByText('Everything is committed')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Remote' }), 'git@lab:gene/notes.git')
    await user.click(screen.getByRole('button', { name: 'Save remote' }))
    expect(api.setRemote).toHaveBeenCalledWith('space', 'git@lab:gene/notes.git', null)
    expect(await screen.findByText('1 commit to push', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Push now' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Push automatically' })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Space history' }))
    expect(useTabs.getState().tabs.some((t) => t.history.some((h) => h.kind === 'spaceHistory'))).toBe(true)
  })

  it('shows a diverged remote as a problem', async () => {
    api.status.mockResolvedValue({
      ...ON,
      remote: {
        name: 'origin', url: 'https://example.com/n.git', branch: 'main', autoPush: true, ahead: 2, behind: 3,
        diverged: true, neverPushed: false, lastPush: null, lastFetch: null, blocked: null,
      },
    })
    render(<VersionControlSection />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Remote has diverged: 3 commits there and 2 here.')
  })

  it('turning the switch off disables it', async () => {
    api.status.mockResolvedValue(ON)
    api.disable.mockResolvedValue(OFF)
    const user = userEvent.setup()
    render(<VersionControlSection />)
    const row = await screen.findByRole('region', { name: 'Version control' }).catch(() => null)
    const sw = row ? within(row).getByRole('switch') : await screen.findByRole('switch', { name: 'Version control' })
    await user.click(sw)
    await waitFor(() => expect(api.disable).toHaveBeenCalledWith('space'))
  })
})
