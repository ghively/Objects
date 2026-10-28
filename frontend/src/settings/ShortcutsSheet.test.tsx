import { act, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { CATEGORY_LABELS, allShortcuts, formatKeys } from '@/lib/shortcuts'
import '@/theme/shortcuts'
import { ShortcutsSheet } from './ShortcutsSheet'
import { resetSettingsModal, useSettingsModal } from './useSettingsModal'

beforeEach(() => resetSettingsModal())

describe('ShortcutsSheet', () => {
  test('test shortcuts sheet lists every registered shortcut by category with unverified tags', async () => {
    render(<ShortcutsSheet />)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => useSettingsModal.getState().openShortcuts())
    const sheet = await screen.findByRole('dialog', { name: 'Shortcuts' })

    const defs = allShortcuts()
    expect(defs.length).toBeGreaterThan(40)
    const categories = [...new Set(defs.map((d) => d.category))]
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
    // openSettings (Mod-,) is verified; toggleDarkMode is provisional.
    expect(sheet.querySelector('[data-shortcut="openSettings"] [data-unverified]')).toBeNull()
    expect(sheet.querySelector('[data-shortcut="toggleDarkMode"] [data-unverified]')?.textContent).toBe('unverified')
  })
})
