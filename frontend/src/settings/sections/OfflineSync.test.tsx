// M9 Task 16: "Rebuild search index"; polish 2026-11-03 moved it from Space Settings to
// Offline & Sync.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

vi.mock('@/api/laneFApi', () => ({
  laneFApi: { storage: vi.fn(() => new Promise(() => undefined)), clearMediaCache: vi.fn() },
}))

import { api } from '@/api/client'
import { laneFApi } from '@/api/laneFApi'
import type { SpaceInfo } from '@/api/types'
import { getMediaToken, resetMediaToken } from '@/settings/mediaLoading'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { OFFLINE_SYNC_SEARCH, OFFLINE_SYNC_TEXT, OfflineSyncSection, REINDEX_POLL_MS } from './OfflineSync'

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
    // No cloud: no sync status or cloud media storage.
    expect(screen.queryByText('Sync')).toBeNull()
    expect(screen.queryByText(/cloud/i)).toBeNull()
  })
})

// M31 item 15c: the local rows the catalog lists: Local Storage, Media loading, Clear media cache.
describe('Offline & Sync local rows', () => {
  beforeEach(() => {
    useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
    vi.mocked(laneFApi.storage).mockResolvedValue({
      space: { bytes: 2_621_440, files: 12 },
      cache: { bytes: 1_048_576, files: 2 },
      state: { bytes: 512, files: 1 },
      total: 3_670_528,
      cacheFolder: '/spaces/Lab/.object-cache',
    })
    vi.mocked(laneFApi.clearMediaCache).mockResolvedValue({ files: 3, bytes: 1536 })
    resetMediaToken()
  })

  test('test Local Storage shows the size estimate', async () => {
    render(<OfflineSyncSection />)
    const group = screen.getByRole('region', { name: 'Local Storage' })
    expect(await within(group).findByText('2.5 MB')).toBeInTheDocument()
    expect(within(group).getByText(OFFLINE_SYNC_TEXT.storageSpace)).toBeInTheDocument()
    expect(within(group).getByText(OFFLINE_SYNC_TEXT.storageCache)).toBeInTheDocument()
    expect(within(group).getByText(OFFLINE_SYNC_TEXT.storageState)).toBeInTheDocument()
    expect(within(group).getByText('1.0 MB')).toBeInTheDocument()
    expect(within(group).getByText('3.5 MB')).toBeInTheDocument()
    expect(within(group).getByText('512 B')).toBeInTheDocument()
    expect(within(group).getByText(OFFLINE_SYNC_TEXT.storageTotal)).toBeInTheDocument()
    expect(laneFApi.storage).toHaveBeenCalledTimes(1)
  })

  test('test Media loading is Everything or Required only', async () => {
    const user = userEvent.setup()
    render(<OfflineSyncSection />)
    const group = screen.getByRole('radiogroup', { name: 'Media loading' })
    expect(within(group).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Everything', 'Required only'])
    expect(within(group).getByRole('radio', { name: 'Everything' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(group).getByRole('radio', { name: 'Required only' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ mediaLoading: 'required' }, { baseRevision: 'r0' })
    expect(useSettings.getState().settings.mediaLoading).toBe('required')
  })

  test('test Clear media cache asks first, then reports what it freed', async () => {
    const user = userEvent.setup()
    render(<OfflineSyncSection />)
    const group = screen.getByRole('region', { name: 'Clear media cache' })
    await user.click(within(group).getByRole('button', { name: 'Clear media cache' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(OFFLINE_SYNC_TEXT.clearConfirmTitle)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(laneFApi.clearMediaCache).not.toHaveBeenCalled()

    await user.click(within(group).getByRole('button', { name: 'Clear media cache' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Clear media cache' }))
    await waitFor(() => expect(laneFApi.clearMediaCache).toHaveBeenCalledTimes(1))
    expect(await within(group).findByText(OFFLINE_SYNC_TEXT.cleared(3, '1.5 KB'))).toBeInTheDocument()
    // Pages load their media afresh, and the storage estimate is read again.
    expect(getMediaToken()).not.toBeNull()
    await waitFor(() => expect(laneFApi.storage).toHaveBeenCalledTimes(2))
  })

  test('test Clear media cache with nothing cached says so', async () => {
    vi.mocked(laneFApi.clearMediaCache).mockResolvedValue({ files: 0, bytes: 0 })
    const user = userEvent.setup()
    render(<OfflineSyncSection />)
    const group = screen.getByRole('region', { name: 'Clear media cache' })
    await user.click(within(group).getByRole('button', { name: 'Clear media cache' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Clear media cache' }))
    expect(await within(group).findByText(OFFLINE_SYNC_TEXT.nothingCleared)).toBeInTheDocument()
  })

  test('test the search terms include the local rows', () => {
    for (const s of ['Local Storage', 'Media loading', 'Clear media cache']) expect(OFFLINE_SYNC_SEARCH).toContain(s)
  })
})
