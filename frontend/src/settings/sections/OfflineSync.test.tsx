// M9 Task 16: "Rebuild search index"; polish 2026-11-03 moved it from Space Settings to
// Offline & Sync.
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
import { OFFLINE_SYNC_TEXT, OfflineSyncSection, REINDEX_POLL_MS } from './OfflineSync'

const mocked = vi.mocked(api)
const SPACE: SpaceInfo = { name: 'Lab', root: '/spaces/Lab', types: [], icon: null, description: null, hideTaskManagement: false, revision: 's1' }

const BUTTON = 'Rebuild search index'
const DESCRIPTION =
  'Rebuilds the search index from your notes. Try it only when search misses things or views look out of date; normally it is never needed.'
const HEADING = 'Rebuilding the index'
const RUNNING = 'Object is reading your notes again for search, backlinks and views.'

beforeEach(() => {
  vi.clearAllMocks()
  resetSpaceInfo()
  mocked.space.mockResolvedValue(SPACE)
  mocked.search.mockResolvedValue({ results: [], partial: false })
  mocked.reindex.mockResolvedValue({ started: true })
})

describe('Rebuild search index', () => {
  test('test button calls reindex', async () => {
    const user = userEvent.setup()
    render(<OfflineSyncSection />)
    await user.click(screen.getByRole('button', { name: BUTTON }))
    await waitFor(() => expect(mocked.reindex).toHaveBeenCalledTimes(1))
  })

  test('test indexing state strings while partial', async () => {
    const user = userEvent.setup()
    render(<OfflineSyncSection />)
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
    render(<OfflineSyncSection />)
    expect(await screen.findByText(HEADING)).toBeInTheDocument()
  })

  test('test strings verbatim', () => {
    expect(OFFLINE_SYNC_TEXT.reindexButton).toBe(BUTTON)
    expect(OFFLINE_SYNC_TEXT.reindexDescription).toBe(DESCRIPTION)
    expect(OFFLINE_SYNC_TEXT.reindexingHeading).toBe(HEADING)
    expect(OFFLINE_SYNC_TEXT.reindexingDescription).toBe(RUNNING)
    render(<OfflineSyncSection />)
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument()
  })
})

describe('Offline & Sync', () => {
  test('test the section keeps only the local parts', () => {
    render(<OfflineSyncSection />)
    expect(screen.getByRole('heading', { level: 2, name: 'Offline & Sync' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Offline' })).toBeInTheDocument()
    // No cloud: no sync status, media loading or cloud media storage.
    expect(screen.queryByText('Sync')).toBeNull()
    expect(screen.queryByText('Media loading')).toBeNull()
  })
})
