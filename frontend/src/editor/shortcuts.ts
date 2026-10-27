/**
 * The editor's shortcuts. The ids, names (`shortcuts.<id>.name`), categories
 * (`shortcuts.categories.text` / `.block`) and keys live in the one registry,
 * `lib/shortcuts.ts`; this module registers the editor-scope ones (again: the
 * registry keeps one entry per id, so this is idempotent) and turns them into
 * a ProseMirror key map through `keysFor(id)`, so correcting a key in the
 * registry needs no other edit. Every key here is provisional (the plan's key
 * table; Gene confirms them in the hand-check).
 */
import { M7_SHORTCUTS, keysFor, registerShortcuts, type ShortcutDef } from '@/lib/shortcuts'

/** The editor-scope shortcuts of the plan's "Shortcut keys" table. */
export const EDITOR_SHORTCUTS: ShortcutDef[] = M7_SHORTCUTS.filter((d) => d.scope === 'editor').map((d) => ({
  ...d,
  provisional: true,
}))

/** The editor-scope ids, in the table's order. */
export const EDITOR_SHORTCUT_IDS: string[] = EDITOR_SHORTCUTS.map((d) => d.id)

let registered = false
/** Register the editor shortcuts with the registry (once; later corrections there win). */
export function registerEditorShortcuts(): void {
  if (registered) return
  registered = true
  const missing = EDITOR_SHORTCUTS.filter((d) => keysFor(d.id).length === 0)
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
