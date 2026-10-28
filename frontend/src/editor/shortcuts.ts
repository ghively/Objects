/**
 * The editor's shortcuts. The ids, names (`shortcuts.<id>.name`), categories
 * (`shortcuts.categories.text` / `.block`) and keys live in the one registry,
 * `lib/shortcuts.ts`; this module registers the editor-scope ones (again: the
 * registry keeps one entry per id, so this is idempotent) and turns them into
 * a ProseMirror key map through `keysFor(id)`, so correcting a key in the
 * registry needs no other edit. The keys are Capacities' (its shortcut table;
 * reference-check-2026-10-28 §1); an id with no key there has none here.
 */
import { Extension, type Editor } from '@tiptap/core'
import { M7_SHORTCUTS, M8_SHORTCUTS, allShortcuts, isMacPlatform, keysFor, registerShortcuts, type ShortcutDef } from '@/lib/shortcuts'
import { NOT_AVAILABLE, NotBuiltYet } from '@/lib/notBuilt'
import { showToast } from './media/upload'
import { blockSelectionKey } from './extensions/blockSelection'
import { copyBlockReference } from './nodes/blockRef'
import { runHighlightText } from './nodes/textStyle'
import { turnIntoObject, turnIntoTask, turnTodoIntoTask } from './turnInto'

/** The editor-scope shortcuts of the plan's "Shortcut keys" table. */
export const EDITOR_SHORTCUTS: ShortcutDef[] = M7_SHORTCUTS.filter((d) => d.scope === 'editor')

/** The editor-scope ids, in the table's order. */
export const EDITOR_SHORTCUT_IDS: string[] = EDITOR_SHORTCUTS.map((d) => d.id)

/** M8's editor-scope shortcuts: the registry's own entries (`lib/shortcuts.ts`), not copies. */
export const M8_EDITOR_SHORTCUTS: ShortcutDef[] = M8_SHORTCUTS.filter((d) => d.scope === 'editor')

export const M8_EDITOR_SHORTCUT_IDS: string[] = M8_EDITOR_SHORTCUTS.map((d) => d.id)

let registered = false
/** Register the editor shortcuts with the registry (once; an id it already has keeps its entry). */
export function registerEditorShortcuts(): void {
  if (registered) return
  registered = true
  const known = new Set(allShortcuts().map((d) => d.id))
  const missing = [...EDITOR_SHORTCUTS, ...M8_EDITOR_SHORTCUTS].filter((d) => !known.has(d.id))
  if (missing.length) registerShortcuts(missing)
}
registerEditorShortcuts()

/** A registry key as ProseMirror names it: `AltCtrl` is Alt, or Ctrl on macOS. */
export function proseMirrorKey(spec: string, mac = isMacPlatform()): string {
  return spec
    .split('-')
    .map((part, i, all) => (i < all.length - 1 && part === 'AltCtrl' ? (mac ? 'Ctrl' : 'Alt') : part))
    .join('-')
}

/**
 * A ProseMirror key map from shortcut ids to handlers, read from the registry
 * now. Two ids on one key run in order until one returns true.
 */
export function keymapFor(handlers: Record<string, () => boolean>): Record<string, () => boolean> {
  const map: Record<string, () => boolean> = {}
  for (const [id, run] of Object.entries(handlers)) {
    for (const spec of keysFor(id)) {
      const key = proseMirrorKey(spec)
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
      // `I` only with blocks selected; otherwise the letter is typed.
      turnIntoObject: () => !!blockSelectionKey.getState(editor.state) && runAction(() => turnIntoObject(editor)),
      turnIntoTask: () => runAction(() => turnIntoTask(editor)),
      turnBlockIntoTaskObject: () => runAction(() => turnTodoIntoTask(editor)),
      highlightText: () => runHighlightText(editor),
    })
  },
})
