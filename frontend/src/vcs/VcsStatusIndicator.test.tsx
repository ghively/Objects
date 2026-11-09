import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VcsStatus } from '@/api/vcsClient'

vi.mock('@/api/vcsClient', () => ({ vcsApi: { status: vi.fn() } }))

import { vcsApi } from '@/api/vcsClient'
import { useTabs } from '@/nav/tabs'
import { VcsStatusIndicator } from './VcsStatusIndicator'
import { useVcsStatus } from './useVcsStatus'
import { relativeWhen, statusLine } from './vcsText'

const api = vi.mocked(vcsApi)
const NOW = Date.parse('2026-11-08T12:00:00Z')
const BASE: VcsStatus = { target: 'space', gitAvailable: true, enabled: true, repository: true, root: '/s', remote: null }

beforeEach(() => {
  useVcsStatus.setState({ space: null })
  api.status.mockReset()
})

describe('the sidebar backup line', () => {
  it('shows nothing while version control is off or unknown', async () => {
    api.status.mockResolvedValue({ ...BASE, enabled: false })
    const { container } = render(<VcsStatusIndicator />)
    await vi.waitFor(() => expect(api.status).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    expect(statusLine(null, NOW)).toBeNull()
  })

  it('says when it was last saved or backed up, and opens Space history', async () => {
    api.status.mockResolvedValue({
      ...BASE,
      lastCommit: { sha: 'a', short: 'a', at: new Date(Date.now() - 5 * 60_000).toISOString(), message: 'Object: edit' },
    })
    const user = userEvent.setup()
    render(<VcsStatusIndicator />)
    const button = await screen.findByRole('button', { name: /Saved 5 min ago/ })
    expect(button).toHaveAttribute('data-vcs-status', 'muted')
    expect(button).toHaveAttribute('title', expect.stringContaining('No remote set'))
    await user.click(button)
    expect(useTabs.getState().tabs.some((t) => t.history.some((h) => h.kind === 'spaceHistory'))).toBe(true)

    const pushed: VcsStatus = {
      ...BASE,
      remote: {
        name: 'origin', url: 'u', branch: 'main', autoPush: true, ahead: 0, behind: 0, diverged: false, neverPushed: false,
        lastPush: '2026-11-08T11:58:00Z', lastFetch: null, blocked: null,
      },
    }
    expect(statusLine(pushed, NOW)).toEqual({ text: 'Backed up 2 min ago', tone: 'muted' })
  })

  it('shows a problem in the danger colour', async () => {
    api.status.mockResolvedValue({ ...BASE, error: { at: '2026-11-08T11:00:00Z', message: 'The push didn’t go through.' } })
    render(<VcsStatusIndicator />)
    const button = await screen.findByRole('button', { name: /Backup problem/ })
    expect(button).toHaveAttribute('data-vcs-status', 'danger')
    expect(button).toHaveAttribute('title', expect.stringContaining('The push didn’t go through.'))
  })

  it('words times relative to now', () => {
    expect(relativeWhen('2026-11-08T11:59:40Z', NOW)).toBe('just now')
    expect(relativeWhen('2026-11-08T09:00:00Z', NOW)).toBe('3 h ago')
  })
})
