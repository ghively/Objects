/**
 * Ctrl+Home and Ctrl+End (with Shift: selecting) move the caret to the start and the end of the
 * note (M32).
 *
 * These were left to the browser, whose "go to the start" lands on the first thing in the text.
 * When that is a to-do, it is the to-do's box, which holds no caret: the selection never moved,
 * so Ctrl+Home did nothing in a note that starts with a to-do (the 2026-11-11 hands-on walk). The
 * editor now puts the caret at the first and the last place text can go.
 */
import { Extension } from '@tiptap/core'
import { Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'

type Dispatch = ((tr: Transaction) => void) | undefined

function moveTo(state: EditorState, dispatch: Dispatch, end: 'start' | 'end', extend: boolean): boolean {
  const target = end === 'start' ? Selection.atStart(state.doc) : Selection.atEnd(state.doc)
  const head = end === 'start' ? target.from : target.to
  // Selecting keeps where the selection began; a place that holds no caret (an image first or
  // last) is taken as the browser would take it.
  const selection =
    extend && target instanceof TextSelection ? TextSelection.create(state.doc, state.selection.anchor, head) : target
  if (dispatch) dispatch(state.tr.setSelection(selection).scrollIntoView())
  return true
}

export const DocumentEnds = Extension.create({
  name: 'documentEnds',

  addKeyboardShortcuts() {
    const run = (end: 'start' | 'end', extend: boolean) => () => moveTo(this.editor.state, this.editor.view.dispatch, end, extend)
    return {
      'Mod-Home': run('start', false),
      'Mod-End': run('end', false),
      'Shift-Mod-Home': run('start', true),
      'Shift-Mod-End': run('end', true),
    }
  },
})
