import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { VersionInfo } from '@/api/types'
import { objectDetail, objectSummary } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError, ConflictError } from '@/api/client'
import { registerFlusher } from '@/lib/flush'
import { useVersionHistory } from './useVersionHistory'
import { VERSION_HISTORY as S, VersionHistoryDialog } from './VersionHistoryDialog'
import { countBlocks, versionCounts, versionProperties } from './VersionPreview'

const mocked = vi.mocked(api)
const PATH = 'Pages/Notes.md'

function v(id: string, number: number, kind: VersionInfo['kind'] = 'object'): VersionInfo {
  return { id, number, at: `2026-10-2${number}T10:00:00Z`, size: 10, kind, title: 'Notes' }
}

const TEXTS: Record<string, string> = {
  a: '---\ntitle: Notes\ntype: page\n---\nFirst paragraph.\n',
  b: '---\ntitle: Notes\ntype: page\nstatus: Done\ntags:\n  - one\n  - two\n---\nOne.\n\nTwo with *style*.\n',
}

beforeEach(() => {
  mocked.history.mockResolvedValue([v('b', 2), v('a', 1)])
  mocked.historyVersion.mockImplementation(async (_p: string, id: string) => ({ id, text: TEXTS[id] ?? '' }))
  mocked.object.mockImplementation(async (path: string) =>
    objectDetail({ summary: objectSummary({ path }), version: 'v-current' }),
  )
  mocked.restoreVersion.mockResolvedValue({ version: 'v-new' })
})

afterEach(() => {
  act(() => useVersionHistory.getState().close())
  mocked.history.mockReset()
  mocked.historyVersion.mockReset()
  mocked.object.mockReset()
  mocked.restoreVersion.mockReset()
  document.querySelectorAll('[data-editor-toasts]').forEach((n) => n.remove())
})

function openDialog(path = PATH) {
  render(<VersionHistoryDialog />)
  act(() => useVersionHistory.getState().open(path))
}

describe('version text helpers', () => {
  test('counts blocks and properties, leaving kept keys out', () => {
    expect(countBlocks('One.\n\nTwo.\n\n- a\n- b\n')).toBe(3)
    expect(versionCounts(TEXTS.b)).toEqual({ blocks: 2, properties: 2 })
    expect(versionProperties(TEXTS.b)).toEqual([
      { key: 'status', value: 'Done' },
      { key: 'tags', value: 'one, two' },
    ])
    expect(versionProperties('no frontmatter')).toEqual([])
    expect(versionProperties('---\nlist: [a, "b c"]\nq: "x: y"\n---\n')).toEqual([
      { key: 'list', value: 'a, b c' },
      { key: 'q', value: 'x: y' },
    ])
  })
})

describe('VersionHistoryDialog', () => {
  test('test lists versions newest first with counts', async () => {
    openDialog()
    expect(await screen.findByText(S.title)).toBeTruthy()
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => within(o).getByText(/^Version \d+$/).textContent)).toEqual(['Version 2', 'Version 1'])
    expect(await within(options[0]).findByText('2 blocks · 2 properties')).toBeTruthy()
    expect(await within(options[1]).findByText('1 block · 0 properties')).toBeTruthy()
    expect(mocked.history).toHaveBeenCalledWith(PATH)
    // Nothing selected yet.
    expect(screen.getByText(S.selectTitle)).toBeTruthy()
    expect(screen.getByText(S.selectDescription, { selector: 'div' })).toBeTruthy()
  })

  test('test selecting shows the preview', async () => {
    openDialog()
    const options = await screen.findAllByRole('option')
    fireEvent.click(options[0])
    const preview = await screen.findByTestId('version-preview')
    await waitFor(() => expect(preview.textContent).toContain('Two with style.'))
    expect(within(preview).getByText('Properties')).toBeTruthy()
    expect(within(preview).getByText('status')).toBeTruthy()
    expect(within(preview).getByText('one, two')).toBeTruthy()
    expect(preview.querySelector('[contenteditable="true"]')).toBeNull()
    expect(options[0].getAttribute('aria-selected')).toBe('true')
  })

  test('test restore asks then restores and reports success', async () => {
    const order: string[] = []
    const unregister = registerFlusher(async () => {
      order.push('flush')
    })
    mocked.object.mockImplementation(async (path: string) => {
      order.push('object')
      return objectDetail({ summary: objectSummary({ path }), version: 'v-current' })
    })
    try {
      openDialog()
      fireEvent.click((await screen.findAllByRole('option'))[1])
      fireEvent.click(await screen.findByRole('button', { name: S.restore }))
      expect(await screen.findByText(S.restoreConfirmTitle)).toBeTruthy()
      expect(screen.getByText(S.restoreConfirmDescription(1))).toBeTruthy()
      expect(screen.getByText(S.restoreKeepsFiles)).toBeTruthy()
      expect(mocked.restoreVersion).not.toHaveBeenCalled()

      // Cancel restores nothing.
      fireEvent.click(screen.getByRole('button', { name: S.restoreConfirmCancel }))
      await waitFor(() => expect(screen.queryByText(S.restoreConfirmTitle)).toBeNull())
      expect(mocked.restoreVersion).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: S.restore }))
      const dialog = await screen.findByRole('alertdialog')
      fireEvent.click(within(dialog).getByRole('button', { name: S.restoreConfirmConfirm }))
      await waitFor(() => expect(mocked.restoreVersion).toHaveBeenCalledWith(PATH, 'a', { baseVersion: 'v-current' }))
      expect(order).toEqual(['flush', 'object'])
      expect(await screen.findByText(S.restoreSuccess)).toBeTruthy()
      await waitFor(() => expect(useVersionHistory.getState().path).toBeNull())
    } finally {
      unregister()
    }
  })

  test('test restore conflict reloads', async () => {
    mocked.restoreVersion.mockRejectedValue(new ConflictError('v-other'))
    openDialog()
    fireEvent.click((await screen.findAllByRole('option'))[0])
    fireEvent.click(await screen.findByRole('button', { name: S.restore }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: S.restoreConfirmConfirm }))
    expect(await screen.findByText(S.changedElsewhere)).toBeTruthy()
    await waitFor(() => expect(mocked.history).toHaveBeenCalledTimes(2))
    expect(useVersionHistory.getState().path).toBe(PATH)

    // Any other failure says the restore error.
    mocked.restoreVersion.mockRejectedValue(new ApiError(500, 'boom'))
    fireEvent.click((await screen.findAllByRole('option'))[0])
    fireEvent.click(await screen.findByRole('button', { name: S.restore }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: S.restoreConfirmConfirm }))
    expect(await screen.findByText(S.restoreError)).toBeTruthy()
    expect(screen.getByText(S.restoreErrorDescription)).toBeTruthy()
  })

  test('test whiteboard versions are restore only', async () => {
    mocked.history.mockResolvedValue([v('w2', 2, 'whiteboard'), v('w1', 1, 'whiteboard')])
    mocked.historyVersion.mockResolvedValue({ id: 'w1', text: null })
    openDialog('Whiteboards/Board.md')
    fireEvent.click((await screen.findAllByRole('option'))[1])
    expect(await screen.findByText(S.restoreOnlyTitle)).toBeTruthy()
    expect(screen.getByText(S.restoreOnlyDescription)).toBeTruthy()
    expect(screen.queryByTestId('version-preview')).toBeNull()
    expect(mocked.historyVersion).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: S.restore }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: S.restoreConfirmConfirm }))
    await waitFor(() =>
      expect(mocked.restoreVersion).toHaveBeenCalledWith('Whiteboards/Board.md', 'w1', { baseVersion: 'v-current' }),
    )
  })

  test('test empty and error states use the expected strings', async () => {
    mocked.history.mockResolvedValue([])
    openDialog()
    expect(await screen.findByText('No version history available yet')).toBeTruthy()
    expect(screen.getByText('Versions will appear here after this object is edited.')).toBeTruthy()
    act(() => useVersionHistory.getState().close())

    mocked.history.mockRejectedValue(new ApiError(500, 'boom'))
    act(() => useVersionHistory.getState().open(PATH))
    expect(await screen.findByText('Failed to load version history')).toBeTruthy()
    expect(screen.getByText("Could not get this object's versions. Please retry.")).toBeTruthy()
    act(() => useVersionHistory.getState().close())

    mocked.history.mockResolvedValue([v('b', 2), v('a', 1)])
    mocked.historyVersion.mockRejectedValue(new ApiError(500, 'boom'))
    act(() => useVersionHistory.getState().open(PATH))
    fireEvent.click((await screen.findAllByRole('option'))[0])
    expect(await screen.findByText("Couldn't load this version")).toBeTruthy()
    expect(screen.getByText("Could not get this version's content. Please retry.")).toBeTruthy()
  })
})
