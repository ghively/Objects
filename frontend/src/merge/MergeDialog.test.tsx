import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { objectDetail, objectSummary } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError, ConflictError } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { useTabs } from '@/nav/tabs'
import { MERGE_LIMIT, MERGE_OBJECT, MERGE_TAG, MergeDialog } from './MergeDialog'
import { useMerge } from './useMerge'

const mocked = vi.mocked(api)

const OBJECTS = [
  objectSummary({ path: 'Pages/Source.md', title: 'Source' }),
  objectSummary({ path: 'Pages/Target.md', title: 'Target' }),
  objectSummary({ path: 'People/Ada.md', type: 'person', title: 'Ada' }),
  objectSummary({ path: 'Tags/Old.md', type: 'tag', title: 'Old' }),
  objectSummary({ path: 'Tags/New.md', type: 'tag', title: 'New' }),
]

beforeEach(() => {
  resetLinkIndex()
  mocked.objects.mockResolvedValue(OBJECTS)
  mocked.object.mockImplementation(async (path: string) =>
    objectDetail({ summary: objectSummary({ path }), version: `v-${path}` }),
  )
})

afterEach(() => {
  act(() => useMerge.getState().close())
  vi.restoreAllMocks()
  mocked.mergeObject.mockReset()
  mocked.objects.mockReset()
  mocked.object.mockReset()
})

describe('MergeDialog', () => {
  test('test merge picker excludes the source and lists only tags for a tag', async () => {
    render(<MergeDialog />)
    act(() => useMerge.getState().open('Pages/Source.md'))
    expect((await screen.findAllByText('Merge into')).length).toBeGreaterThan(0)
    await screen.findByText('Target')
    expect(screen.getByText('Ada')).toBeTruthy()
    expect(screen.queryByText('Source')).toBeNull()
    expect(screen.queryByText('Old')).toBeNull()
    expect(screen.queryByText('New')).toBeNull()

    act(() => useMerge.getState().open('Tags/Old.md'))
    await screen.findByText('New')
    expect(screen.queryByText('Old')).toBeNull()
    expect(screen.queryByText('Target')).toBeNull()

    // Nothing else of the kind: the empty strings.
    mocked.objects.mockResolvedValue([OBJECTS[3]])
    act(() => useMerge.getState().close())
    act(() => useMerge.getState().open('Tags/Old.md'))
    expect(await screen.findByText(MERGE_TAG.nothingFound)).toBeTruthy()
    mocked.objects.mockResolvedValue([OBJECTS[0]])
    act(() => useMerge.getState().close())
    act(() => useMerge.getState().open('Pages/Source.md'))
    expect(await screen.findByText(MERGE_OBJECT.nothingFound)).toBeTruthy()
  })

  test('shows Loading… while the list loads', async () => {
    let resolve: (v: typeof OBJECTS) => void = () => undefined
    mocked.objects.mockReturnValue(new Promise((r) => (resolve = r)))
    render(<MergeDialog />)
    act(() => useMerge.getState().open('Pages/Source.md'))
    expect(await screen.findByText('Loading…')).toBeTruthy()
    await act(async () => resolve(OBJECTS))
    expect(await screen.findByText('Target')).toBeTruthy()
  })

  test('test confirm then merge opens the target', async () => {
    const open = vi.spyOn(useTabs.getState(), 'open').mockImplementation(() => undefined)
    let finish: () => void = () => undefined
    mocked.mergeObject.mockImplementation(
      (_s: string, target: string, opts: { targetVersion: string }) =>
        new Promise((r) => {
          finish = () =>
            r({ target, version: `${opts.targetVersion}+1`, relinked: [], skipped: [], dropped: [], trashId: 't1' })
        }),
    )
    render(<MergeDialog />)
    act(() => useMerge.getState().open('Pages/Source.md'))
    fireEvent.click(await screen.findByText('Target'))
    expect(screen.getByText('Merge “Source” into “Target”?')).toBeTruthy()
    expect(
      screen.getByText(
        '“Target” keeps the single values it already has, picks up the list items from “Source”, which also fills any properties that are blank. Its content goes at the end.',
      ),
    ).toBeTruthy()
    expect(mocked.mergeObject).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Merge'))
    expect(await screen.findByText('Merging objects…')).toBeTruthy()
    await waitFor(() =>
      expect(mocked.mergeObject).toHaveBeenCalledWith('Pages/Source.md', 'Pages/Target.md', {
        sourceVersion: 'v-Pages/Source.md',
        targetVersion: 'v-Pages/Target.md',
      }),
    )
    await act(async () => finish())
    await waitFor(() => expect(useMerge.getState().source).toBeNull())
    expect(open).toHaveBeenCalledWith({ kind: 'object', path: 'Pages/Target.md' })
    expect(document.querySelector('[data-editor-toasts]')?.textContent).toContain('Objects merged')
  })

  test('tag confirm uses the tag strings', async () => {
    vi.spyOn(useTabs.getState(), 'open').mockImplementation(() => undefined)
    mocked.mergeObject.mockResolvedValue({ target: 'Tags/New.md', version: 'v2', relinked: [], skipped: [], dropped: [], trashId: 't' })
    render(<MergeDialog />)
    act(() => useMerge.getState().open('Tags/Old.md'))
    fireEvent.click(await screen.findByText('New'))
    expect(screen.getByText('Anything tagged here moves to “New”.')).toBeTruthy()
    fireEvent.click(screen.getByText('Merge'))
    await waitFor(() => expect(useMerge.getState().source).toBeNull())
    expect(document.querySelector('[data-editor-toasts]')?.textContent).toContain('Tags merged')
  })

  test('test errors use the expected strings', async () => {
    render(<MergeDialog />)
    act(() => useMerge.getState().open('Pages/Source.md'))
    fireEvent.click(await screen.findByText('Target'))

    mocked.mergeObject.mockRejectedValueOnce(new ApiError(413, 'too large'))
    fireEvent.click(screen.getByText('Merge'))
    expect(await screen.findByText('Too many references to merge this object')).toBeTruthy()
    expect(
      screen.getByText(
        `A merge can move at most ${MERGE_LIMIT} references. Pick a smaller object to merge here, or drop some of its links before trying again.`,
      ),
    ).toBeTruthy()
    expect(MERGE_LIMIT).toBe(5000)

    mocked.mergeObject.mockRejectedValueOnce(new ConflictError('v9'))
    fireEvent.click(screen.getByText('Merge'))
    expect(await screen.findByText('Could not merge objects')).toBeTruthy()
    expect(useMerge.getState().source).toBe('Pages/Source.md')

    act(() => useMerge.getState().close())
    act(() => useMerge.getState().open('Tags/Old.md'))
    fireEvent.click(await screen.findByText('New'))
    mocked.mergeObject.mockRejectedValueOnce(new ApiError(413, 'too large'))
    fireEvent.click(screen.getByText('Merge'))
    expect(await screen.findByText('Too many references to merge this tag')).toBeTruthy()
    expect(
      screen.getByText(
        'A merge can move at most 5000 references. Pick a smaller tag to merge here, or untag some objects before trying again.',
      ),
    ).toBeTruthy()
    mocked.mergeObject.mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(screen.getByText('Merge'))
    expect(await screen.findByText('Could not merge tags')).toBeTruthy()
  })
})
