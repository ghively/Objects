import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { GlobalOverlays } from '@/shell/GlobalOverlays'
import { resetPinned } from '@/shell/usePinned'
import { SETTINGS_SECTIONS, SettingsModal } from './SettingsModal'
import { resetSettingsModal, useSettingsModal } from './useSettingsModal'
import { resetSpaceInfo } from './useSpaceInfo'

beforeEach(() => {
  vi.clearAllMocks()
  resetSettingsModal()
  resetSpaceInfo()
  resetPinned()
})

function openModal(section?: Parameters<ReturnType<typeof useSettingsModal.getState>['open']>[0]) {
  act(() => useSettingsModal.getState().open(section))
}

describe('SettingsModal', () => {
  test('test settings nav groups and section headings', async () => {
    render(<SettingsModal />)
    openModal()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Settings')).toBeInTheDocument()
    const nav = within(dialog).getByRole('navigation', { name: 'Settings' })
    const groups = within(nav).getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['General', 'Space'])
    expect(within(groups[0]).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Appearance',
      'AI Assistant',
      'Editor',
      'Date & Time',
      'Language',
      'Offline & Sync',
      'Import Content',
      'Full Export',
      'Notifications',
    ])
    expect(within(groups[1]).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Space Settings',
      'Version control',
      'Object Types',
      'Task management',
      'Automations',
      'Work',
      'Integrations',
    ])
    expect(within(nav).getByRole('button', { name: 'Shortcuts' })).toBeInTheDocument()
    expect(within(nav).getByPlaceholderText('Search settings')).toBeInTheDocument()
    // Catalog section 1: the nav's footer shows the version, under the Shortcuts row.
    const version = await within(nav).findByText('Object 0.1.0')
    expect(version).toHaveAttribute('data-app-version', '0.1.0')
    // ... and a Reload row (the catalog's footer: version, Diagnostics, Reload).
    expect(within(nav).getByRole('button', { name: 'Reload' })).toBeInTheDocument()

    // Each row shows its section's heading.
    for (const s of SETTINGS_SECTIONS) {
      await userEvent.click(within(nav).getByRole('button', { name: s.label }))
      expect(within(dialog).getByRole('heading', { level: 2, name: s.label })).toBeInTheDocument()
    }
  })

  test('test search filters sections and shows No results', async () => {
    const user = userEvent.setup()
    render(<SettingsModal />)
    openModal()
    const dialog = await screen.findByRole('dialog')
    const search = within(dialog).getByRole('searchbox', { name: 'Search settings' })

    // An option label finds its section.
    await user.type(search, 'monochrome')
    const nav = within(dialog).getByRole('navigation', { name: 'Settings' })
    expect(within(nav).getAllByRole('group').flatMap((g) => within(g).getAllByRole('button').map((b) => b.textContent))).toEqual([
      'Appearance',
    ])
    await user.clear(search)
    await user.type(search, 'hide task')
    expect(within(nav).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Space'])
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Task management' })).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'zzzz nothing')
    expect(within(nav).queryAllByRole('group')).toHaveLength(0)
    expect(within(dialog).getAllByText('No results').length).toBeGreaterThan(0)
  })

  test('test gear, openSettings and toggleShortcutsMenu open the modal and the sheet', async () => {
    render(<GlobalOverlays />)
    expect(screen.queryByRole('dialog')).toBeNull()

    // openSettings: Mod-, (Ctrl on Linux).
    await userEvent.keyboard('{Control>},{/Control}')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Appearance' })).toBeInTheDocument()

    // The settings nav's "Shortcuts" row opens the sheet in its place.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Shortcuts' }))
    const sheet = await screen.findByRole('dialog', { name: 'Shortcuts' })
    expect(sheet).toBeInTheDocument()
    expect(useSettingsModal.getState().isOpen).toBe(false)

    // toggleShortcutsMenu: Mod-Shift-b closes it, and opens it again.
    await userEvent.keyboard('{Control>}{Shift>}B{/Shift}{/Control}')
    expect(useSettingsModal.getState().shortcutsOpen).toBe(false)
    await userEvent.keyboard('{Control>}{Shift>}B{/Shift}{/Control}')
    expect(await screen.findByRole('dialog', { name: 'Shortcuts' })).toBeInTheDocument()

    // Opening on a requested section (the spaces menu's "Space settings").
    act(() => useSettingsModal.getState().open('space'))
    const again = await screen.findByRole('dialog', { name: 'Settings' })
    expect(within(again).getByRole('heading', { level: 2, name: 'Space Settings' })).toBeInTheDocument()
  })
})
