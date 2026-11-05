// M15 T1: the import dialog stub (source step and preview call) and its entry in Settings.
// Lane U extends this file with the mapping step, the target, progress and the finish.
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { ImportContentSection } from '@/settings/sections/ImportContent'
import { resetSettingsModal, useSettingsModal } from '@/settings/useSettingsModal'
import { IMPORT_TEXT, ImportDialog } from './ImportDialog'
import { resetImportDialog, useImportDialog } from './useImportDialog'

const mocked = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  resetImportDialog()
  resetSettingsModal()
})

describe('ImportDialog (T1 stub)', () => {
  test('test preview reads the path with the chosen source and writes nothing', async () => {
    const user = userEvent.setup()
    render(<ImportDialog />)
    act(() => useImportDialog.getState().open({ kind: 'notion' }))
    await screen.findByRole('dialog', { name: IMPORT_TEXT.title })
    expect(screen.getByRole('combobox', { name: IMPORT_TEXT.kind })).toHaveValue('notion')
    const preview = screen.getByRole('button', { name: IMPORT_TEXT.preview })
    expect(preview).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: IMPORT_TEXT.source }), '/home/gene/Downloads/export.zip')
    await user.click(preview)
    await waitFor(() =>
      expect(mocked.importPreview).toHaveBeenCalledWith({ source: { path: '/home/gene/Downloads/export.zip', kind: 'notion' } }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(IMPORT_TEXT.summary(0, 0, 0))
    expect(mocked.startImport).not.toHaveBeenCalled()
  })

  test('test settings import content opens the dialog, preset per source', async () => {
    const user = userEvent.setup()
    act(() => useSettingsModal.getState().open('importContent'))
    render(<ImportContentSection />)
    expect(screen.getByRole('heading', { level: 2, name: 'Import Content' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start importing' }))
    expect(useImportDialog.getState()).toMatchObject({ isOpen: true, preset: { kind: 'auto' } })
    expect(useSettingsModal.getState().isOpen).toBe(false)
    act(() => useImportDialog.getState().close())
    await user.click(screen.getByRole('button', { name: 'Import from Obsidian' }))
    expect(useImportDialog.getState()).toMatchObject({ isOpen: true, preset: { kind: 'obsidian' } })
  })
})
