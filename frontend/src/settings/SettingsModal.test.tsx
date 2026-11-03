import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { GlobalOverlays } from '@/shell/GlobalOverlays'
import { resetPinned } from '@/shell/usePinned'
import { SETTINGS_SECTIONS, SETTINGS_TEXT, SettingsModal } from './SettingsModal'
import { resetSettingsModal, useSettingsModal } from './useSettingsModal'
import { resetSpaceInfo } from './useSpaceInfo'
import { APPEARANCE_TEXT } from './sections/Appearance'
import { DATE_TIME_TEXT } from './sections/DateTime'
import { EDITOR_TEXT } from './sections/Editor'
import { LANGUAGE_TEXT } from './sections/Language'
import { NOTIFICATIONS_TEXT } from './sections/Notifications'
import { OBJECT_TYPES_TEXT } from './sections/ObjectTypes'
import { SPACE_SETTINGS_TEXT } from './sections/SpaceSettings'
import { TASK_MANAGEMENT_TEXT } from './sections/TaskManagement'
import { SHORTCUTS_TEXT } from './ShortcutsSheet'

const STRINGS = readFileSync(
  path.resolve(import.meta.dirname, '../../../docs/strings.txt'),
  'utf8',
)
const inReference = (text: string) => STRINGS.includes(`s:\`${text}\``) || STRINGS.includes(`v:\`${text}\``)

/** Strings marked "our string" (or "our string, adapted from …") in the section files. */
const OUR_STRINGS = new Set<string>([
  APPEARANCE_TEXT.themeDescription,
  APPEARANCE_TEXT.fontDescription,
  EDITOR_TEXT.description,
  EDITOR_TEXT.startup,
  EDITOR_TEXT.startupSpaceDescription,
  NOTIFICATIONS_TEXT.description,
  NOTIFICATIONS_TEXT.limitsHeading,
  NOTIFICATIONS_TEXT.limitsBody,
  SPACE_SETTINGS_TEXT.description,
  TASK_MANAGEMENT_TEXT.hideDescription,
  SHORTCUTS_TEXT.unverified,
  SHORTCUTS_TEXT.unverifiedHelp,
  // M8 Task 7
  LANGUAGE_TEXT.info,
  DATE_TIME_TEXT.timeZoneMismatch,
  DATE_TIME_TEXT.timeZoneSearch,
  // Polish 2026-11-03
  APPEARANCE_TEXT.textSize,
  APPEARANCE_TEXT.textSizeDescription,
  EDITOR_TEXT.spellCheckLangDescription,
])

function leaves(o: unknown): string[] {
  if (typeof o === 'string') return [o]
  if (o && typeof o === 'object') return Object.values(o).flatMap(leaves)
  return []
}

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
  test('test settings nav groups and section headings match reference', async () => {
    render(<SettingsModal />)
    openModal()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Settings')).toBeInTheDocument()
    const nav = within(dialog).getByRole('navigation', { name: 'Settings' })
    const groups = within(nav).getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['General', 'Space'])
    expect(within(groups[0]).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Appearance',
      'Editor',
      'Date & Time',
      'Language',
      'Notifications',
    ])
    expect(within(groups[1]).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Space Settings',
      'Object Types',
      'Task management',
    ])
    expect(within(nav).getByRole('button', { name: 'Shortcuts' })).toBeInTheDocument()
    expect(within(nav).getByPlaceholderText('Search settings')).toBeInTheDocument()

    // Every label and help text is a verbatim reference string, unless it is marked "our string".
    const all = [
      ...SETTINGS_SECTIONS.map((x) => x.label),
      ...leaves([SETTINGS_TEXT, APPEARANCE_TEXT, EDITOR_TEXT, DATE_TIME_TEXT, LANGUAGE_TEXT, NOTIFICATIONS_TEXT, SPACE_SETTINGS_TEXT, OBJECT_TYPES_TEXT, TASK_MANAGEMENT_TEXT, SHORTCUTS_TEXT]),
    ]
    for (const text of all) {
      if (OUR_STRINGS.has(text)) {
        expect(inReference(text), `our string found verbatim: ${text}`).toBe(false)
      } else {
        expect(inReference(text), text).toBe(true)
      }
    }

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
