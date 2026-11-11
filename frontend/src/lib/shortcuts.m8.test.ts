// M8 Task 3: the new shortcut ids of the plan's "Shortcut keys (new ids, provisional)" table.
import { describe, expect, test } from 'vitest'
import {
  CATEGORY_LABELS,
  EXISTING_SHORTCUTS,
  M7_SHORTCUTS,
  M8_SHORTCUTS,
  PRESENTATION_ONLY_IDS,
  allShortcuts,
  keysFor,
  parseKeys,
  sharesKeyByDesign,
} from './shortcuts'

// id → [category, scope, name, keys]
const TABLE: Record<string, [string, string, string, string[]]> = {
  copyBlockReference: ['block', 'editor', 'Copy block reference', ['Mod-AltCtrl-l']],
  turnIntoObject: ['block', 'editor', 'Turn into a note', ['i']],
  turnIntoTask: ['block', 'editor', 'Turn into task', []],
  turnBlockIntoTaskObject: ['block', 'editor', 'Make this block a task', ['Mod-Shift-t']],
  highlightText: ['text', 'editor', 'Highlight the selected text', ['Mod-Shift-h']],
  toggleFocusMode: ['global', 'global', 'Toggle focus mode', ['Mod-Shift-m']],
  openPresentationMode: ['page', 'global', 'Start presentation mode', ['Mod-AltCtrl-p']],
  exitPresentationMode: ['page', 'global', 'Exit presentation mode', ['Escape']],
  nextPresentationSlide: ['page', 'global', 'Next presentation slide', ['ArrowRight']],
  previousPresentationSlide: ['page', 'global', 'Back one slide in the presentation', ['ArrowLeft']],
  whiteboardResize: [
    'whiteboard',
    'whiteboard',
    'Resize selection',
    ['Mod-ArrowUp', 'Mod-ArrowDown', 'Mod-ArrowLeft', 'Mod-ArrowRight'],
  ],
  whiteboardResizeLarge: [
    'whiteboard',
    'whiteboard',
    'Resize the selection in bigger steps',
    ['Mod-Shift-ArrowUp', 'Mod-Shift-ArrowDown', 'Mod-Shift-ArrowLeft', 'Mod-Shift-ArrowRight'],
  ],
}

describe('M8 shortcuts', () => {
  test('test new shortcut ids exist with their names and categories', () => {
    const registered = new Map(allShortcuts().map((d) => [d.id, d]))
    expect(M8_SHORTCUTS.map((d) => d.id).sort()).toEqual(Object.keys(TABLE).sort())
    for (const [id, [category, scope, name, keys]] of Object.entries(TABLE)) {
      const d = registered.get(id)
      expect(d, id).toBeTruthy()
      expect(d?.category, id).toBe(category)
      expect(d?.scope, id).toBe(scope)
      expect(d?.name, id).toBe(name)
      // Every key is checked against the shortcut table (the behaviour catalog's Shortcuts sheet).
      expect(d?.provisional, id).toBe(false)
      expect(d?.bound, id).toBe(true)
      expect(keysFor(id)).toEqual(keys)
      expect(CATEGORY_LABELS[category]).toBeTruthy()
    }
    // M7's indent ids stay (Tab / Shift-Tab, now in any block: Task 25).
    expect(keysFor('indentBlocks')).toEqual(['Tab'])
    expect(keysFor('unindentBlocks')).toEqual(['Shift-Tab'])
    expect(PRESENTATION_ONLY_IDS).toEqual(['exitPresentationMode', 'nextPresentationSlide', 'previousPresentationSlide'])
  })

  test('sweep 2026-11-08 #3: Underline is unbound (Ctrl+U is "Add new content"); toggles open on Ctrl+Up/Down', () => {
    expect(keysFor('underline')).toEqual([])
    expect(allShortcuts().find((d) => d.id === 'underline')?.name).toBe('Underline')
    const holders = (key: string) => allShortcuts().filter((d) => d.keys.includes(key)).map((d) => d.id)
    expect(holders('Mod-u')).toEqual(['openAddEntityMenu'])
    expect(keysFor('toggleToggleInBlockWithCursor')).toEqual(['Mod-Enter', 'Mod-Shift-Enter', 'Mod-ArrowUp', 'Mod-ArrowDown'])
  })

  test('sweep 2026-11-08 #3: no two registered ids in one scope share a key, on either platform', () => {
    const scopeOf = (id: string, scope: string) => (PRESENTATION_ONLY_IDS.includes(id) ? 'presentation' : scope)
    for (const platform of ['Win32', 'MacIntel']) {
      const mac = platform === 'MacIntel'
      const seen = new Map<string, string>()
      for (const d of allShortcuts()) {
        for (const k of d.keys) {
          const c = parseKeys(k, mac)
          const sig = k.includes(' ')
            ? `${scopeOf(d.id, d.scope)}|seq|${k.toLowerCase()}`
            : `${scopeOf(d.id, d.scope)}|${c.ctrl}|${c.meta}|${c.alt}|${c.shift}|${c.key.toLowerCase()}`
          const other = seen.get(sig)
          if (other && sharesKeyByDesign(other, d.id)) continue
          expect(other, `${d.id} (${k}) collides with ${other} in scope ${d.scope} on ${platform}`).toBeUndefined()
          seen.set(sig, d.id)
        }
      }
    }
  })

  test('test provisional keys do not collide with existing bindings in the same scope', () => {
    // The presentation-only keys are bound only while presenting: their own scope.
    const scopeOf = (id: string, scope: string) => (PRESENTATION_ONLY_IDS.includes(id) ? 'presentation' : scope)
    for (const platform of ['Win32', 'MacIntel']) {
      const mac = platform === 'MacIntel'
      const seen = new Map<string, string>()
      for (const d of [...EXISTING_SHORTCUTS, ...M7_SHORTCUTS, ...M8_SHORTCUTS]) {
        for (const k of d.keys) {
          const c = parseKeys(k, mac)
          const sig = `${scopeOf(d.id, d.scope)}|${c.ctrl}|${c.meta}|${c.alt}|${c.shift}|${c.key.toLowerCase()}`
          const other = seen.get(sig)
          if (other && sharesKeyByDesign(other, d.id)) continue
          expect(other, `${d.id} (${k}) collides with ${other} in scope ${d.scope}`).toBeUndefined()
          seen.set(sig, d.id)
        }
      }
    }
  })
})
