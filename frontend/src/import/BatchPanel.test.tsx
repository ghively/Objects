// M25: the finish step's batch panel: reconciling counts, Move batch to Trash, Take source / Keep mine.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
  announceResync: vi.fn(),
}))

import { announceResync, api } from '@/api/client'
import type { ImportResult } from '@/api/types'
import { BatchPanel } from './BatchPanel'
import { IMPORT_TEXT as T } from './text'

const mocked = vi.mocked(api)

const RESULT: ImportResult = {
  targetPath: '/space',
  spaceName: 'Work',
  objects: 3,
  types: 0,
  attachments: 0,
  tags: 0,
  skipped: 0,
  reportPath: 'Pages/Import report.md',
  cancelled: false,
  batch: 'B1',
  updated: 1,
  unchanged: 2,
  changedInBoth: 2,
  removed: 1,
  leftOut: 1,
  failed: 0,
  originals: 0,
  sourceItems: 9,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocked.importBatch.mockResolvedValue({
    batch: { id: 'B1', startedAt: '', source: { path: '', kind: '', system: '' }, counts: {} },
    items: [
      { sourcePath: 'a.md', system: 'obsidian', id: 'a.md', title: 'Alpha', path: 'Pages/Alpha.md', action: 'conflict' },
      { sourcePath: 'b.md', system: 'obsidian', id: 'b.md', title: 'Beta', path: 'Pages/Beta.md', action: 'conflict' },
      { sourcePath: 'c.md', system: 'obsidian', id: 'c.md', title: 'Gamma', path: 'Pages/Gamma.md', action: 'created' },
    ],
  })
})

describe('BatchPanel', () => {
  test('test the counts reconcile in one line and removed-at-source is mentioned', () => {
    render(<BatchPanel result={RESULT} inOpenSpace />)
    expect(screen.getByText(T.accountedFor(RESULT))).toBeInTheDocument()
    expect(screen.getByText(T.removedAtSource(1))).toBeInTheDocument()
  })

  test('test nothing renders without a batch (an older server)', () => {
    const { container } = render(<BatchPanel result={{ ...RESULT, batch: null }} inOpenSpace />)
    expect(container).toBeEmptyDOMElement()
  })

  test('test Move batch to Trash asks first, then moves and says how many', async () => {
    mocked.trashImportBatch.mockResolvedValue({ trashed: 3, missing: 0 })
    const user = userEvent.setup()
    render(<BatchPanel result={RESULT} inOpenSpace />)
    await user.click(screen.getByRole('button', { name: T.moveBatch }))
    expect(mocked.trashImportBatch).not.toHaveBeenCalled()
    expect(screen.getByText(T.moveBatchConfirm(3))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: T.moveBatchDo }))
    expect(await screen.findByRole('status')).toHaveTextContent(T.moveBatchDone(3))
    expect(mocked.trashImportBatch).toHaveBeenCalledWith('B1')
    expect(announceResync).toHaveBeenCalled()
  })

  test('test changed in both lists each object with Take source and Keep mine, and for all', async () => {
    mocked.resolveImportBatch.mockResolvedValue({ resolved: ['Pages/Alpha.md'], failed: [], pending: 1 })
    const user = userEvent.setup()
    render(<BatchPanel result={RESULT} inOpenSpace />)
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.queryByText('Gamma')).toBeNull()
    await user.click(screen.getAllByRole('button', { name: T.takeSource })[0])
    await waitFor(() => expect(mocked.resolveImportBatch).toHaveBeenCalledWith('B1', 'take', ['Pages/Alpha.md']))
    await user.click(screen.getByRole('button', { name: T.keepAll }))
    await waitFor(() => expect(mocked.resolveImportBatch).toHaveBeenLastCalledWith('B1', 'keep', undefined))
  })

  test('test a batch in another space offers no actions', () => {
    render(<BatchPanel result={RESULT} inOpenSpace={false} />)
    expect(screen.queryByRole('button', { name: T.moveBatch })).toBeNull()
    expect(screen.getByText(T.moveBatchOther)).toBeInTheDocument()
    expect(mocked.importBatch).not.toHaveBeenCalled()
  })
})
