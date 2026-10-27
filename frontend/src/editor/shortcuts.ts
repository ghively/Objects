/**
 * The editor's shortcuts. The ids, names (`shortcuts.<id>.name`), categories
 * (`shortcuts.categories.text` / `.block`) and keys live in the one registry,
 * `lib/shortcuts.ts`; this module registers the editor-scope ones (again: the
 * registry keeps one entry per id, so this is idempotent) and turns them into
 * a ProseMirror key map through `keysFor(id)`, so correcting a key in the
 * registry needs no other edit. Every key here is provisional (the plan's key
 * table; Gene confirms them in the hand-check).
 */
import { Extension, type Editor } from '@tiptap/core'
import { M7_SHORTCUTS, keysFor, registerShortcuts, type ShortcutDef } from '@/lib/shortcuts'
import { NOT_AVAILABLE, NotBuiltYet } from '@/lib/notBuilt'
import { showToast } from './media/upload'
import { copyBlockReference } from './nodes/blockRef'
import { runHighlightText } from './nodes/textStyle'
import { turnIntoObject, turnIntoTask, turnTodoIntoTask } from './turnInto'

/** The editor-scope shortcuts of the plan's "Shortcut keys" table. */
export const EDITOR_SHORTCUTS: ShortcutDef[] = M7_SHORTCUTS.filter((d) => d.scope === 'editor').map((d) => ({
  ...d,
  provisional: true,
}))

/** The editor-scope ids, in the table's order. */
export const EDITOR_SHORTCUT_IDS: string[] = EDITOR_SHORTCUTS.map((d) => d.id)

/**
 * M8's editor-scope shortcuts (the plan's key table; names `shortcuts.<id>.name`,
 * verbatim). `lib/shortcuts.ts` registers them too (Task 3); these entries only
 * fill in an id the registry does not have yet, so its keys always win.
 */
export const M8_EDITOR_SHORTCUTS: ShortcutDef[] = [
  { id: 'copyBlockReference', category: 'block', name: 'Copy block reference', keys: ['Mod-Alt-r'], scope: 'editor', provisional: true, bound: true },
  { id: 'turnIntoObject', category: 'block', name: 'Turn into object', keys: ['Mod-Alt-o'], scope: 'editor', provisional: true, bound: true },
  { id: 'turnIntoTask', category: 'block', name: 'Turn into task', keys: ['Mod-Alt-k'], scope: 'editor', provisional: true, bound: true },
  { id: 'turnBlockIntoTaskObject', category: 'block', name: 'Turn block into task object', keys: ['Mod-Alt-Shift-k'], scope: 'editor', provisional: true, bound: true },
  { id: 'highlightText', category: 'text', name: 'Highlight text selection', keys: ['Mod-Shift-h'], scope: 'editor', provisional: true, bound: true },
]

export const M8_EDITOR_SHORTCUT_IDS: string[] = M8_EDITOR_SHORTCUTS.map((d) => d.id)

let registered = false
/** Register the editor shortcuts with the registry (once; later corrections there win). */
export function registerEditorShortcuts(): void {
  if (registered) return
  registered = true
  const missing = [...EDITOR_SHORTCUTS, ...M8_EDITOR_SHORTCUTS].filter((d) => keysFor(d.id).length === 0)
  if (missing.length) registerShortcuts(missing)
}
registerEditorShortcuts()

/**
 * A ProseMirror key map from shortcut ids to handlers, read from the registry
 * now. Two ids on one key run in order until one returns true.
 */
export function keymapFor(handlers: Record<string, () => boolean>): Record<string, () => boolean> {
  const map: Record<string, () => boolean> = {}
  for (const [id, run] of Object.entries(handlers)) {
    for (const key of keysFor(id)) {
      const before = map[key]
      map[key] = before ? () => before() || run() : run
    }
  }
  return map
}

// ---------------------------------------------------------------------------
// M8 bindings

/** Run an async editor action; a stub that is not built yet shows "Not available yet". */
function runAction(action: () => Promise<boolean>): boolean {
  void action().catch((err) => {
    if (err instanceof NotBuiltYet) showToast(NOT_AVAILABLE)
  })
  return true
}

/** Text blocks where Tab keeps its own meaning (table cells move, code indents). */
const OWN_TAB = new Set(['tableCell', 'tableHeader', 'codeBlock', 'rawBlock'])

function tabOwnedElsewhere(editor: Editor): boolean {
  const $from = editor.state.selection.$from
  for (let d = $from.depth; d >= 0; d--) if (OWN_TAB.has($from.node(d).type.name)) return true
  return false
}

/**
 * Tab / Shift-Tab with the caret in any block (`indentBlocks` / `unindentBlocks`):
 * indent it under the block before it, or move it out of its `indent`
 * container. Runs after `BlockSelection` (block selections and list items keep
 * M7's behaviour) and leaves tables and code blocks alone. The key is consumed
 * in any other block so focus stays in the editor.
 */
export function indentAtCursor(editor: Editor, dir: 1 | -1): boolean {
  if (!editor.isEditable || tabOwnedElsewhere(editor)) return false
  if (dir === 1) editor.commands.indentBlock()
  else editor.commands.unindentBlock()
  return true
}

/** The editor's M8 key bindings, from the registry's keys. */
export const M8Keys = Extension.create({
  name: 'm8Keys',
  // After `BlockSelection` (900), before the built-in keymaps and the tables'.
  priority: 850,

  addKeyboardShortcuts() {
    const editor = this.editor
    return keymapFor({
      indentBlocks: () => indentAtCursor(editor, 1),
      unindentBlocks: () => indentAtCursor(editor, -1),
      copyBlockReference: () => copyBlockReference(editor),
      turnIntoObject: () => runAction(() => turnIntoObject(editor)),
      turnIntoTask: () => runAction(() => turnIntoTask(editor)),
      turnBlockIntoTaskObject: () => runAction(() => turnTodoIntoTask(editor)),
      highlightText: () => runHighlightText(editor),
    })
  },
})
