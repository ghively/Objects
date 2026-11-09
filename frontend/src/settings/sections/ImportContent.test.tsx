// M15: Settings > General > "Import Content" opens the import dialog, detecting the source or
// preset to one; each source says in a line how to make its export.
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetImportDialog, useImportDialog } from '@/import/useImportDialog'
import { resetSettingsModal, useSettingsModal } from '@/settings/useSettingsModal'
import { IMPORT_CONTENT_TEXT, ImportContentSection } from './ImportContent'

const T = IMPORT_CONTENT_TEXT

beforeEach(() => {
  vi.clearAllMocks()
  resetImportDialog()
  resetSettingsModal()
})

describe('Import Content', () => {
  test('test settings import content opens the dialog, preset per source', async () => {
    const user = userEvent.setup()
    act(() => useSettingsModal.getState().open('importContent'))
    render(<ImportContentSection />)
    expect(screen.getByRole('heading', { level: 2, name: 'Import Content' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start importing' }))
    expect(useImportDialog.getState()).toMatchObject({ isOpen: true, preset: { kind: 'auto' } })
    expect(useSettingsModal.getState().isOpen).toBe(false)
    for (const [label, kind] of [
      ['Notion', 'notion'],
      ['Obsidian', 'obsidian'],
      ['Anytype', 'anytype'],
    ] as const) {
      act(() => useImportDialog.getState().close())
      act(() => useSettingsModal.getState().open('importContent'))
      await user.click(screen.getByRole('button', { name: `Import from ${label}` }))
      expect(useImportDialog.getState()).toMatchObject({ isOpen: true, preset: { kind } })
      expect(useSettingsModal.getState().isOpen).toBe(false)
    }
  })

  test('test each source says how to make its export', () => {
    render(<ImportContentSection />)
    const sources = screen.getByRole('region', { name: T.sources })
    expect(within(sources).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Import from Notion' })).toHaveAccessibleDescription(T.notionHelp)
    expect(screen.getByRole('button', { name: 'Import from Obsidian' })).toHaveAccessibleDescription(T.obsidianHelp)
    expect(screen.getByRole('button', { name: 'Import from Anytype' })).toHaveAccessibleDescription(T.anytypeHelp)
    expect(screen.getByText(T.startImportingDescription)).toBeInTheDocument()
  })

  test('test import history reopens the review of an earlier batch (fix pass H)', async () => {
    vi.mocked(api.importBatches).mockResolvedValueOnce([
      {
        id: 'b2',
        startedAt: '2026-11-08T10:00:00',
        finishedAt: '2026-11-08T10:01:00',
        source: { path: '/home/gene/Vault', kind: 'obsidian', system: 'obsidian' },
        counts: { imported: 12 },
      },
      { id: 'b1', startedAt: '2026-11-07T09:00:00', source: { path: '/x/old.zip', kind: 'notion', system: 'notion' }, counts: {}, trashedAt: 'x' },
    ])
    const user = userEvent.setup()
    act(() => useSettingsModal.getState().open('importContent'))
    render(<ImportContentSection />)
    const button = await screen.findByRole('button', { name: T.reviewLabel('Vault') })
    expect(screen.getByText('2026-11-08 10:01 · 12 objects')).toBeInTheDocument()
    // A batch moved to the Trash has nothing left to review.
    expect(screen.queryByRole('button', { name: T.reviewLabel('old.zip') })).toBeNull()
    await user.click(button)
    expect(useImportDialog.getState()).toMatchObject({ isOpen: true, preset: { reviewBatch: 'b2' } })
    expect(useSettingsModal.getState().isOpen).toBe(false)
  })

  test('test import history says when nothing was imported', async () => {
    act(() => useSettingsModal.getState().open('importContent'))
    render(<ImportContentSection />)
    expect(await screen.findByText(T.historyEmpty)).toBeInTheDocument()
  })
})
