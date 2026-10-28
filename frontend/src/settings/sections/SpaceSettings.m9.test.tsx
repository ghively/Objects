// M9 Task 16: "Recalculate content index" in Space Settings (Object keeps it under
// Offline & Sync; Object has no such section).
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { SpaceInfo } from '@/api/types'
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { REINDEX_POLL_MS, SPACE_SETTINGS_TEXT, SpaceSettingsSection } from './SpaceSettings'

const mocked = vi.mocked(api)
const SPACE: SpaceInfo = { name: 'Lab', root: '/spaces/Lab', types: [], icon: null, description: null, hideTaskManagement: false, revision: 's1' }

const BUTTON = 'Recalculate content index'
const DESCRIPTION =
  'If some of your views are inconsistent or search results are not returning content, you can reindex your notes. This is usually not needed, only use it if you are having issues.'
const HEADING = 'Content is being indexed'
const RUNNING = 'Your notes are getting analyzed for search, backlinking, and your content views.'

beforeEach(() => {
  vi.clearAllMocks()
  resetSpaceInfo()
  mocked.space.mockResolvedValue(SPACE)
  mocked.search.mockResolvedValue({ results: [], partial: false })
  mocked.reindex.mockResolvedValue({ started: true })
})

describe('Recalculate content index', () => {
  test('test button calls reindex', async () => {
    const user = userEvent.setup()
    render(<SpaceSettingsSection />)
    await user.click(screen.getByRole('button', { name: BUTTON }))
    await waitFor(() => expect(mocked.reindex).toHaveBeenCalledTimes(1))
  })

  test('test indexing state strings while partial', async () => {
    const user = userEvent.setup()
    render(<SpaceSettingsSection />)
    await waitFor(() => expect(mocked.search).toHaveBeenCalled())
    expect(screen.queryByText(HEADING)).toBeNull()

    // After the click the index is rebuilt: search reports `partial` until it is done.
    mocked.search.mockResolvedValue({ results: [], partial: true })
    await user.click(screen.getByRole('button', { name: BUTTON }))
    expect(await screen.findByText(HEADING)).toBeInTheDocument()
    expect(screen.getByText(RUNNING)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: BUTTON })).toBeDisabled()

    mocked.search.mockResolvedValue({ results: [], partial: false })
    await waitFor(() => expect(screen.queryByText(HEADING)).toBeNull(), { timeout: REINDEX_POLL_MS * 3 })
    expect(screen.getByRole('button', { name: BUTTON })).toBeEnabled()
  })

  test('test indexing state shows when search is already partial on open', async () => {
    mocked.search.mockResolvedValue({ results: [], partial: true })
    render(<SpaceSettingsSection />)
    expect(await screen.findByText(HEADING)).toBeInTheDocument()
  })

  test('test strings verbatim', () => {
    expect(SPACE_SETTINGS_TEXT.reindexButton).toBe(BUTTON)
    expect(SPACE_SETTINGS_TEXT.reindexDescription).toBe(DESCRIPTION)
    expect(SPACE_SETTINGS_TEXT.reindexingHeading).toBe(HEADING)
    expect(SPACE_SETTINGS_TEXT.reindexingDescription).toBe(RUNNING)
    render(<SpaceSettingsSection />)
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument()
  })
})
