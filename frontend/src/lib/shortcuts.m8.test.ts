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
} from './shortcuts'

// id → [category, scope, `shortcuts.<id>.name` (verbatim from the reference strings), keys]
const TABLE: Record<string, [string, string, string, string[]]> = {
  copyBlockReference: ['block', 'editor', 'Copy block reference', ['Mod-Alt-r']],
  turnIntoObject: ['block', 'editor', 'Turn into object', ['Mod-Alt-o']],
  turnIntoTask: ['block', 'editor', 'Turn into task', ['Mod-Alt-k']],
  turnBlockIntoTaskObject: ['block', 'editor', 'Turn block into task object', ['Mod-Alt-Shift-k']],
  highlightText: ['text', 'editor', 'Highlight text selection', ['Mod-Shift-h']],
  toggleFocusMode: ['global', 'global', 'Toggle focus mode', ['Mod-Shift-f']],
  openPresentationMode: ['page', 'global', 'Start presentation mode', ['Mod-Alt-p']],
  exitPresentationMode: ['page', 'global', 'Exit presentation mode', ['Escape']],
  nextPresentationSlide: ['page', 'global', 'Next presentation slide', ['ArrowRight']],
  previousPresentationSlide: ['page', 'global', 'Previous presentation slide', ['ArrowLeft']],
  whiteboardResize: [
    'whiteboard',
    'whiteboard',
    'Resize selection',
    ['Mod-Alt-ArrowUp', 'Mod-Alt-ArrowDown', 'Mod-Alt-ArrowLeft', 'Mod-Alt-ArrowRight'],
  ],
  whiteboardResizeLarge: [
    'whiteboard',
    'whiteboard',
    'Resize selection farther',
    ['Mod-Alt-Shift-ArrowUp', 'Mod-Alt-Shift-ArrowDown', 'Mod-Alt-Shift-ArrowLeft', 'Mod-Alt-Shift-ArrowRight'],
  ],
}

describe('M8 shortcuts', () => {
  test('test new shortcut ids exist with reference names and categories', () => {
    const registered = new Map(allShortcuts().map((d) => [d.id, d]))
    expect(M8_SHORTCUTS.map((d) => d.id).sort()).toEqual(Object.keys(TABLE).sort())
    for (const [id, [category, scope, name, keys]] of Object.entries(TABLE)) {
      const d = registered.get(id)
      expect(d, id).toBeTruthy()
      expect(d?.category, id).toBe(category)
      expect(d?.scope, id).toBe(scope)
      expect(d?.name, id).toBe(name)
      expect(d?.provisional, id).toBe(true)
      expect(d?.bound, id).toBe(true)
      expect(keysFor(id)).toEqual(keys)
      expect(CATEGORY_LABELS[category]).toBeTruthy()
    }
    // M7's indent ids stay (Tab / Shift-Tab, now in any block: Task 25).
    expect(keysFor('indentBlocks')).toEqual(['Tab'])
    expect(keysFor('unindentBlocks')).toEqual(['Shift-Tab'])
    expect(PRESENTATION_ONLY_IDS).toEqual(['exitPresentationMode', 'nextPresentationSlide', 'previousPresentationSlide'])
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
          expect(other, `${d.id} (${k}) collides with ${other} in scope ${d.scope}`).toBeUndefined()
          seen.set(sig, d.id)
        }
      }
    }
  })
})
