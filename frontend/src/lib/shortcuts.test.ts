import { afterEach, describe, expect, test, vi } from 'vitest'
import { createElement } from 'react'
import { render } from '@testing-library/react'
import {
  allShortcuts,
  CATEGORY_LABELS,
  EXISTING_SHORTCUTS,
  formatKeys,
  isEditableTarget,
  keysFor,
  M7_SHORTCUTS,
  matches,
  parseKeys,
  registerShortcuts,
  sharesKeyByDesign,
  shortcutsByCategory,
  useGlobalShortcut,
} from './shortcuts'

function setPlatform(p: string) {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(p)
}

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
}

afterEach(() => {
  vi.restoreAllMocks()
})

function Bind({ id, fn, allow }: { id: string; fn: (e: KeyboardEvent) => void; allow?: boolean }) {
  useGlobalShortcut(id, fn, { allowInEditable: allow })
  return createElement('input', { 'aria-label': 'field' })
}

describe('shortcuts', () => {
  test('test shortcut matches Mod per platform and skips editable targets unless allowed', () => {
    setPlatform('Win32')
    expect(matches(key({ key: 'b', ctrlKey: true }), ['Mod-b'])).toBe(true)
    expect(matches(key({ key: 'b', metaKey: true }), ['Mod-b'])).toBe(false)
    expect(matches(key({ key: 'B', ctrlKey: true, shiftKey: true }), ['Mod-b'])).toBe(false)
    expect(matches(key({ key: 'B', ctrlKey: true, shiftKey: true }), ['Mod-Shift-b'])).toBe(true)
    expect(matches(key({ key: ',', ctrlKey: true }), ['Mod-,'])).toBe(true)
    // Shift changes the character; the code still matches.
    expect(matches(key({ key: '|', code: 'Backslash', ctrlKey: true, shiftKey: true }), ['Mod-Shift-\\'])).toBe(true)
    expect(matches(key({ key: '-', ctrlKey: true }), ['Mod--'])).toBe(true)
    expect(matches(key({ key: 'Tab', ctrlKey: true }), ['Ctrl-Tab'])).toBe(true)
    expect(matches(key({ key: 'Enter', altKey: true, shiftKey: true }), ['Alt-Enter'])).toBe(false)
    expect(matches(key({ key: 'Backspace' }), ['Backspace', 'Delete'])).toBe(true)
    expect(matches(key({ key: 'Delete' }), ['Backspace', 'Delete'])).toBe(true)
    expect(formatKeys('Mod-Shift-d')).toBe('Ctrl+Shift+D')

    setPlatform('MacIntel')
    expect(matches(key({ key: 'b', metaKey: true }), ['Mod-b'])).toBe(true)
    expect(matches(key({ key: 'b', ctrlKey: true }), ['Mod-b'])).toBe(false)
    // Option changes the character on macOS; the code still matches.
    expect(matches(key({ key: '¡', code: 'Digit1', metaKey: true, altKey: true }), ['Mod-Alt-1'])).toBe(true)
    expect(matches(key({ key: 'Tab', ctrlKey: true }), ['Ctrl-Tab'])).toBe(true)
    expect(parseKeys('Mod-Shift-k')).toEqual({ ctrl: false, meta: true, alt: false, shift: true, key: 'k' })
    expect(formatKeys('Mod-Shift-d')).toBe('⇧⌘D')

    // The window listener: not in an input unless allowed.
    setPlatform('Linux x86_64')
    const plain = vi.fn()
    const { getByLabelText, unmount } = render(createElement(Bind, { id: 'toggleDarkMode', fn: plain }))
    window.dispatchEvent(key({ key: 'L', ctrlKey: true, shiftKey: true }))
    expect(plain).toHaveBeenCalledTimes(1)
    const field = getByLabelText('field')
    field.dispatchEvent(key({ key: 'L', ctrlKey: true, shiftKey: true }))
    expect(plain).toHaveBeenCalledTimes(1)
    unmount()
    window.dispatchEvent(key({ key: 'L', ctrlKey: true, shiftKey: true }))
    expect(plain).toHaveBeenCalledTimes(1)

    const allowed = vi.fn()
    const r2 = render(createElement(Bind, { id: 'openSettings', fn: allowed, allow: true }))
    const ev = key({ key: ',', ctrlKey: true })
    r2.getByLabelText('field').dispatchEvent(ev)
    expect(allowed).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(true)
    r2.unmount()
  })

  test('AltCtrl is Alt on Windows/Linux and Ctrl on macOS; arrows show as glyphs', () => {
    expect(parseKeys('Mod-AltCtrl-l', false)).toEqual({ ctrl: true, meta: false, alt: true, shift: false, key: 'l' })
    expect(parseKeys('Mod-AltCtrl-l', true)).toEqual({ ctrl: true, meta: true, alt: false, shift: false, key: 'l' })
    expect(formatKeys('Mod-AltCtrl-p', false)).toBe('Ctrl+Alt+P')
    expect(formatKeys('Mod-AltCtrl-p', true)).toBe('⌃⌘P')
    expect(formatKeys('Mod-Shift-ArrowLeft', false)).toBe('Ctrl+Shift+←')
    expect(formatKeys('Alt-ArrowUp', true)).toBe('⌥↑')
    setPlatform('Win32')
    expect(matches(key({ key: 'p', ctrlKey: true, altKey: true }), ['Mod-AltCtrl-p'])).toBe(true)
    setPlatform('MacIntel')
    expect(matches(key({ key: 'p', ctrlKey: true, metaKey: true }), ['Mod-AltCtrl-p'])).toBe(true)
    expect(matches(key({ key: 'p', metaKey: true, altKey: true }), ['Mod-AltCtrl-p'])).toBe(false)
  })

  // Object's shortcut table (shortcuts36682.js; reference-check-2026-10-28 §1), Windows column.
  test("global and navigation keys are Object's own", () => {
    const OBJECT: Record<string, string[]> = {
      closeTab: ['Mod-w'],
      openNewTab: ['Mod-t'],
      navigateTabs: ['Ctrl-Tab'],
      openTabList: ['Mod-Shift-ArrowUp'],
      navigateBack: ['Mod-ArrowLeft', 'Mod-['],
      navigateForward: ['Mod-ArrowRight', 'Mod-]'],
      toggleSidepanel: ['Mod-Shift-ArrowRight'],
      toggleLeftSidebar: ['Mod-Shift-ArrowLeft'],
      toggleCalendarSidebar: ['Mod-Alt-s'],
      toggleDarkMode: ['Mod-Shift-l'],
      openSettings: ['Mod-,'],
      toggleShortcutsMenu: ['Mod-Shift-b'],
      openSearchPalette: ['Mod-p', 'Mod-k'],
      openCommandPalette: [],
      toggleFocusMode: ['Mod-Shift-m'],
      openPresentationMode: ['Mod-AltCtrl-p'],
    }
    for (const [id, keys] of Object.entries(OBJECT)) expect(keysFor(id), id).toEqual(keys)
    for (const id of Object.keys(OBJECT)) expect(allShortcuts().find((d) => d.id === id)?.provisional, id).toBe(false)
  })

  test('isEditableTarget follows App.tsx rule', () => {
    const div = document.createElement('div')
    div.innerHTML = '<div contenteditable="true"><p id="p">x</p></div><div contenteditable="false"><span id="s">y</span></div><textarea id="t"></textarea>'
    document.body.appendChild(div)
    expect(isEditableTarget(div.querySelector('#p'))).toBe(true)
    expect(isEditableTarget(div.querySelector('#s'))).toBe(false)
    expect(isEditableTarget(div.querySelector('#t'))).toBe(true)
    expect(isEditableTarget(document.body)).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
    div.remove()
  })

  test('test registry lists registered shortcuts by category', () => {
    const ids = allShortcuts().map((d) => d.id)
    for (const d of [...M7_SHORTCUTS, ...EXISTING_SHORTCUTS]) expect(ids).toContain(d.id)
    expect(new Set(ids).size).toBe(ids.length)
    const groups = shortcutsByCategory()
    expect(groups.get('text')?.map((d) => d.id)).toEqual(['bold', 'italic', 'underline', 'strikethrough', 'codeToken', 'mathToken', 'highlightText'])
    expect(groups.get('navigation')?.map((d) => d.id)).toContain('closeTab')
    for (const cat of groups.keys()) expect(CATEGORY_LABELS[cat]).toBeTruthy()
    expect(keysFor('openSettings')).toEqual(['Mod-,'])
    expect(keysFor('nope')).toEqual([])
    expect(allShortcuts().find((d) => d.id === 'openSettings')?.provisional).toBe(false)
    expect(allShortcuts().find((d) => d.id === 'toggleDarkMode')?.provisional).toBe(false)
    expect(allShortcuts().find((d) => d.id === 'openSearchPalette')?.bound).toBe(false)

    registerShortcuts([{ id: 'testOnly', category: 'global', name: 'Test', keys: ['Mod-Alt-F9'], scope: 'global', provisional: true }])
    expect(shortcutsByCategory().get('global')?.at(-1)?.id).toBe('testOnly')
    expect(keysFor('testOnly')).toEqual(['Mod-Alt-F9'])
  })

  test('test provisional keys do not collide with existing bindings in the same scope', () => {
    for (const platform of ['Win32', 'MacIntel']) {
      const mac = platform === 'MacIntel'
      const all = [...EXISTING_SHORTCUTS, ...M7_SHORTCUTS]
      const seen = new Map<string, string>()
      for (const d of all) {
        for (const k of d.keys) {
          const c = parseKeys(k, mac)
          const sig = `${d.scope}|${c.ctrl}|${c.meta}|${c.alt}|${c.shift}|${c.key.toLowerCase()}`
          const other = seen.get(sig)
          // Object's context-dependent keys (Mod-e: code token or code block, …).
          if (other && sharesKeyByDesign(other, d.id)) continue
          expect(other, `${d.id} (${k}) collides with ${other} in scope ${d.scope}`).toBeUndefined()
          seen.set(sig, d.id)
        }
      }
    }
  })
})

describe('letter shortcuts and keyboard layouts', () => {
  test('a letter matches the character typed; the physical key only when it is not a Latin letter', () => {
    setPlatform('Win32')
    // AZERTY: the key labelled Z sits where QWERTY has W.
    expect(matches(key({ key: 'z', code: 'KeyW', ctrlKey: true }), ['Mod-w'])).toBe(false)
    expect(matches(key({ key: 'z', code: 'KeyW', ctrlKey: true }), ['Mod-z'])).toBe(true)
    expect(matches(key({ key: 'Q', code: 'KeyA', ctrlKey: true, shiftKey: true }), ['Mod-Shift-a'])).toBe(false)
    // Cyrillic: no Latin character, so the physical key decides.
    expect(matches(key({ key: 'я', code: 'KeyZ', ctrlKey: true }), ['Mod-z'])).toBe(true)
  })
})
