/**
 * Open or close all toggles on the page (`toggleAllToggles`, Ctrl+O; the catalog's Block editing
 * group). If any toggle on the page is closed, every toggle opens; else every toggle closes. Each
 * toggle's `open` option is written in one transaction (its file line changes, the text does not).
 * Bound from the registry by `editor/shortcuts.ts`.
 */
import type { Editor } from '@tiptap/core'
import type { Option } from '../annotations'
import { setOptionAt } from '../nodes/blockOptions'
import { isToggleOpen } from '../nodes/toggle'

/** Open every toggle if one is closed, else close them all. Consumes the key in an editable editor. */
export function toggleAllToggles(editor: Editor): boolean {
  if (!editor.isEditable) return false
  const toggles: { pos: number; open: boolean }[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'toggle') toggles.push({ pos, open: isToggleOpen(node.attrs.blockOptions as Option[] | null) })
    return true
  })
  if (toggles.length === 0) return true
  const open = toggles.some((t) => !t.open)
  const tr = editor.state.tr
  // Writing an attribute keeps every position where it was.
  for (const t of toggles) if (t.open !== open) setOptionAt(tr, t.pos, 'open', open ? true : null)
  if (tr.docChanged) editor.view.dispatch(tr)
  return true
}
