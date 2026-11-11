// M32, "keys work while you type": the new-note and New-menu keys, their second keys, and where
// each may act when the caret is in an editable field.
import { afterEach, describe, expect, test } from 'vitest'
import { allShortcuts, formatKeys, keysFor, matches, newKeyAllowed } from './shortcuts'

const key = (init: KeyboardEventInit, target: Element): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  Object.defineProperty(e, 'target', { value: target })
  return e
}

function mount(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the new-note keys (M32)', () => {
  test('test new note is Ctrl+N and Alt+N; the New menu is Ctrl+U and Alt+Shift+N', () => {
    expect(keysFor('createNewEntityOfType')).toEqual(['Mod-n', 'AltCtrl-n'])
    expect(keysFor('openAddEntityMenu')).toEqual(['Mod-u', 'AltCtrl-Shift-n'])
    expect(keysFor('createNewEntityOfType').map((k) => formatKeys(k, false))).toEqual(['Ctrl+N', 'Alt+N'])
    expect(keysFor('openAddEntityMenu').map((k) => formatKeys(k, false))).toEqual(['Ctrl+U', 'Alt+Shift+N'])
    expect(matches({ key: 'n', code: 'KeyN', ctrlKey: false, metaKey: false, altKey: true, shiftKey: false }, keysFor('createNewEntityOfType'))).toBe(true)
    expect(matches({ key: 'N', code: 'KeyN', ctrlKey: false, metaKey: false, altKey: true, shiftKey: true }, keysFor('openAddEntityMenu'))).toBe(true)
    // Plain N types a letter.
    expect(matches({ key: 'n', code: 'KeyN', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, keysFor('createNewEntityOfType'))).toBe(false)
  })

  test('test the sheet says what the keys do in everyday words', () => {
    const name = (id: string) => allShortcuts().find((d) => d.id === id)?.name
    expect(name('createNewEntityOfType')).toBe('New note, or one more of the type in view')
    expect(name('openAddEntityMenu')).toBe('New')
    expect(name('openTodaysNote')).toBe("Pop out today's daily note")
  })

  test('test outside an editable field the keys always act', () => {
    const host = mount('<button id="b">x</button>')
    const e = key({ key: 'n', ctrlKey: true }, host.querySelector('#b')!)
    expect(newKeyAllowed('createNewEntityOfType', e, false)).toBe(true)
    expect(newKeyAllowed('openAddEntityMenu', key({ key: 'u', ctrlKey: true }, host.querySelector('#b')!), false)).toBe(true)
  })

  test('test in a note the keys act from its text and its title, not from a field outside a note', () => {
    const host = mount(
      '<div data-object-view="page"><input id="title" /><div id="body" contenteditable="true"></div></div><input id="other" />',
    )
    for (const id of ['#title', '#body']) {
      const el = host.querySelector(id)!
      expect(newKeyAllowed('createNewEntityOfType', key({ key: 'n', ctrlKey: true }, el), false)).toBe(true)
      expect(newKeyAllowed('createNewEntityOfType', key({ key: 'n', altKey: true }, el), false)).toBe(true)
      expect(newKeyAllowed('openAddEntityMenu', key({ key: 'u', ctrlKey: true }, el), false)).toBe(true)
      expect(newKeyAllowed('openAddEntityMenu', key({ key: 'N', altKey: true, shiftKey: true }, el), false)).toBe(true)
    }
    const other = host.querySelector('#other')!
    expect(newKeyAllowed('createNewEntityOfType', key({ key: 'n', ctrlKey: true }, other), false)).toBe(false)
    expect(newKeyAllowed('openAddEntityMenu', key({ key: 'u', ctrlKey: true }, other), false)).toBe(false)
  })

  test('test raw mode keeps Ctrl+U (undo selection); Alt+Shift+N opens the menu there, and Ctrl+N makes a note', () => {
    const host = mount('<div data-object-view="page"><div class="cm-editor"><div id="raw" contenteditable="true"></div></div></div>')
    const raw = host.querySelector('#raw')!
    expect(newKeyAllowed('openAddEntityMenu', key({ key: 'u', ctrlKey: true }, raw), false)).toBe(false)
    expect(newKeyAllowed('openAddEntityMenu', key({ key: 'N', altKey: true, shiftKey: true }, raw), false)).toBe(true)
    expect(newKeyAllowed('createNewEntityOfType', key({ key: 'n', ctrlKey: true }, raw), false)).toBe(true)
  })

  test('test on macOS Ctrl+N in a text field stays "next line"; Cmd+N makes a note', () => {
    const host = mount('<div data-object-view="page"><div id="body" contenteditable="true"></div></div>')
    const body = host.querySelector('#body')!
    expect(newKeyAllowed('createNewEntityOfType', key({ key: 'n', ctrlKey: true }, body), true)).toBe(false)
    expect(newKeyAllowed('createNewEntityOfType', key({ key: 'n', metaKey: true }, body), true)).toBe(true)
    expect(keysFor('createNewEntityOfType').map((k) => formatKeys(k, true))).toEqual(['⌘N', '⌃N'])
  })
})
