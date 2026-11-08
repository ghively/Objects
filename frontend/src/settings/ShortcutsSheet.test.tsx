import { act, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { CATEGORY_LABELS, CATEGORY_ORDER, allShortcuts, formatKeys } from '@/lib/shortcuts'
import '@/theme/shortcuts'
import { ShortcutsSheet } from './ShortcutsSheet'
import { resetSettingsModal, useSettingsModal } from './useSettingsModal'
import { settingsDefaults, useSettings } from './useSettings'

beforeEach(() => {
  resetSettingsModal()
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
})

describe('ShortcutsSheet', () => {
  test('test shortcuts sheet lists every registered shortcut with a key, by category, with unverified tags', async () => {
    render(<ShortcutsSheet />)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => useSettingsModal.getState().openShortcuts())
    const sheet = await screen.findByRole('dialog', { name: 'Shortcuts' })

    const defs = allShortcuts().filter((d) => d.keys.length > 0)
    expect(defs.length).toBeGreaterThan(40)
    // Ids with no key are left out.
    expect(sheet.querySelector('[data-shortcut="openCommandPalette"]')).toBeNull()
    // Groups in the catalog's order (`CATEGORY_ORDER`), then the others as registered.
    const registered = [...new Set(defs.map((d) => d.category))]
    const categories = [...CATEGORY_ORDER.filter((c) => registered.includes(c)), ...registered.filter((c) => !CATEGORY_ORDER.includes(c))]
    expect(within(sheet).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(
      categories.map((c) => CATEGORY_LABELS[c] ?? c),
    )
    for (const d of defs) {
      const section = within(sheet).getByRole('region', { name: CATEGORY_LABELS[d.category] ?? d.category })
      const row = section.querySelector(`[data-shortcut="${d.id}"]`)
      expect(row, d.id).not.toBeNull()
      expect(row!.textContent).toContain(d.name)
      for (const k of d.keys) expect(row!.textContent).toContain(formatKeys(k))
      expect(!!row!.querySelector('[data-unverified]'), d.id).toBe(d.provisional)
    }
    // openSettings and toggleDarkMode are verified keys.
    expect(sheet.querySelector('[data-shortcut="openSettings"] [data-unverified]')).toBeNull()
    expect(sheet.querySelector('[data-shortcut="toggleDarkMode"] [data-unverified]')).toBeNull()
    expect(sheet.querySelector('[data-shortcut="toggleDarkMode"] [data-keys]')?.textContent).toBe('Ctrl+Shift+L')
  })

  // The 2026-11-08 sweep: the catalog's General group lists Undo and Redo, and Search this space
  // with both keys; Object has no link command, so no "Insert link" row (no fake rows).
  test('General lists Undo and Redo as display-only rows, and Search this space with Ctrl+P and Ctrl+K', async () => {
    render(<ShortcutsSheet />)
    act(() => useSettingsModal.getState().openShortcuts())
    const sheet = await screen.findByRole('dialog', { name: 'Shortcuts' })
    const general = within(sheet).getByRole('region', { name: 'General' })
    const keysOf = (id: string) => [...general.querySelectorAll(`[data-shortcut="${id}"] [data-keys]`)].map((k) => k.textContent)
    expect(keysOf('undo')).toEqual(['Ctrl+Z'])
    expect(keysOf('redo')).toEqual(['Ctrl+Shift+Z', 'Ctrl+Y'])
    expect(keysOf('openSearchPalette')).toEqual(['Ctrl+P', 'Ctrl+K'])
    // Display-only: the editor and the whiteboard handle Undo and Redo themselves.
    const byId = new Map(allShortcuts().map((d) => [d.id, d]))
    expect(byId.get('undo')?.bound).toBe(false)
    expect(byId.get('redo')?.bound).toBe(false)
    expect(within(sheet).queryByText(/insert.*link|format as link/i)).toBeNull()
    expect(sheet.querySelector('[data-shortcut="insertLink"]')).toBeNull()
  })

  test('sweep 2026-11-08 #5: the group headings read in the catalog order, the uncatalogued groups after', async () => {
    render(<ShortcutsSheet />)
    act(() => useSettingsModal.getState().openShortcuts())
    const sheet = await screen.findByRole('dialog', { name: 'Shortcuts' })
    const headings = within(sheet).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings.slice(0, 7)).toEqual(['General', 'Text editing', 'Block editing', 'Page', 'Navigation', 'Calendar', 'AI Assistant'])
    expect(headings.slice(7)).toContain('Whiteboard')
    expect(CATEGORY_ORDER).toEqual(['global', 'text', 'markdown', 'block', 'page', 'navigation', 'calendar', 'ai', 'table', 'date', 'pdf', 'weblink'])
  })

  test('test the AI Assistant group is left out while AI features are hidden', async () => {
    render(<ShortcutsSheet />)
    act(() => useSettingsModal.getState().openShortcuts())
    const sheet = await screen.findByRole('dialog', { name: 'Shortcuts' })
    expect(within(sheet).getByRole('region', { name: 'AI Assistant' })).toBeInTheDocument()
    expect(sheet.querySelector('[data-shortcut="aiCopyMessage"] [data-keys]')?.textContent).toBe('Ctrl+Alt+C')
    act(() => useSettings.setState({ settings: { ...settingsDefaults, aiHidden: true } }))
    expect(within(sheet).queryByRole('region', { name: 'AI Assistant' })).toBeNull()
  })
})
