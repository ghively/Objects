// M15: Settings > General > "Import Content" opens the import dialog, detecting the source or
// preset to one; each source says in a line how to make its export.
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

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
})
