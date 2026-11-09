// M23 Task 16: two-key sequences and the Work group of the Shortcuts sheet.
import { render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { resetSettingsModal, useSettingsModal } from '@/settings/useSettingsModal'
import { ShortcutsSheet } from '@/settings/ShortcutsSheet'
import { WORK_SHORTCUTS } from '@/work/keys/useWorkKeys'
import { CATEGORY_LABELS, formatKeys, isSequence, matches, parseKeys, shortcutsByCategory } from './shortcuts'

afterEach(() => {
  vi.restoreAllMocks()
  resetSettingsModal()
})

describe('M23 shortcuts', () => {
  test('a key spec with a space is a two-key sequence', () => {
    expect(formatKeys('g n')).toBe('G then N')
    expect(formatKeys('g n', true)).toBe('G then N')
    expect(isSequence('g n')).toBe(true)
    expect(isSequence('Space')).toBe(false)
    const ev = (key: string) => new KeyboardEvent('keydown', { key })
    expect(matches(ev('g'), ['g n'])).toBe(false)
    expect(matches(ev('n'), ['g n'])).toBe(false)
    expect(matches(ev(' '), ['g n'])).toBe(false)
    expect(matches(ev('j'), ['g n', 'j'])).toBe(true)
  })

  test('every Work shortcut is in the work category', () => {
    expect(CATEGORY_LABELS.work).toBe('Work')
    const work = shortcutsByCategory().get('work') ?? []
    for (const d of WORK_SHORTCUTS) {
      expect(work.find((w) => w.id === d.id), d.id).toEqual(d)
      expect(d.scope).toBe('work')
      expect(d.bound).toBe(false)
    }
    const keys = WORK_SHORTCUTS.map((d) => d.keys[0])
    expect(keys).toEqual(['/', 'b', 'g n', 'g w', 'g p', 'g t', 'g o', 'g q', 'g h', 'g s', 'g y', 'g l', 'g e', 'g i', 'g c', 'j', 'k', 'Enter', 'Space', '[', ']', 'Escape', '?'])
    expect(WORK_SHORTCUTS.find((d) => d.keys[0] === 'g n')?.name).toBe('Go to Now')
    expect(WORK_SHORTCUTS.find((d) => d.keys[0] === 'g e')?.name).toBe('Go to Everything')
    // Decision D3: the Drive row's Inbox and Captures get `g i` and `g c`.
    expect(WORK_SHORTCUTS.find((d) => d.keys[0] === 'g i')?.name).toBe('Go to Inbox')
    expect(WORK_SHORTCUTS.find((d) => d.keys[0] === 'g c')?.name).toBe('Go to Captures')
  })

  test('the Shortcuts sheet lists the Work group', () => {
    useSettingsModal.getState().openShortcuts()
    render(createElement(ShortcutsSheet))
    const section = screen.getByRole('region', { name: 'Work' })
    expect(within(section).getByText('Go to Now')).toBeInTheDocument()
    expect(section.querySelector('[data-keys="g n"]')?.textContent).toBe('G then N')
    expect(within(section).getByText('Search work')).toBeInTheDocument()
    expect(section.querySelector('[data-keys="g i"]')?.textContent).toBe('G then I')
    expect(section.querySelector('[data-keys="g c"]')?.textContent).toBe('G then C')
  })

  test('no collision in scope work', () => {
    for (const mac of [false, true]) {
      const seen = new Map<string, string>()
      for (const d of WORK_SHORTCUTS) {
        for (const k of d.keys) {
          const c = parseKeys(k, mac)
          const sig = isSequence(k) ? `seq|${k.toLowerCase()}` : `${c.ctrl}|${c.meta}|${c.alt}|${c.shift}|${c.key.toLowerCase()}`
          expect(seen.get(sig), `${d.id} (${k}) collides with ${seen.get(sig)}`).toBeUndefined()
          seen.set(sig, d.id)
        }
      }
    }
  })
})
