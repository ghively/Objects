/**
 * M32: the caret between a note's title and its body (item 2), and where a body-focus request
 * puts it. The body editor's handle (`BodyEditorHandle`) has no focus or caret call, so this
 * reaches the formatted editor through its DOM node (Tiptap keeps the editor on `.ProseMirror`,
 * as the inline view's own focus already reads it); raw mode takes the focus, and (M33) the caret
 * at its start or end (an exact selection is the formatted editor's only).
 */
import type { Editor as TiptapEditor } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import { getBlockSelection } from '@/editor/extensions/blockSelection'

/** Where the caret goes: the body's start or end, or an exact selection (document positions). */
export type BodyCaret = 'start' | 'end' | { anchor: number; head: number }

type EditorElement = HTMLElement & { editor?: TiptapEditor }

/** The formatted body editor of the view under `root`, or null (raw mode, or not mounted yet). */
export function bodyEditorOf(root: ParentNode | null | undefined): TiptapEditor | null {
  const ed = root?.querySelector<EditorElement>('.object-body-text .ProseMirror')?.editor
  return ed && !ed.isDestroyed ? ed : null
}

/**
 * Put the caret in the body of the view under `root` and give it the focus now (the next key
 * lands there). False when the body can't take it (read-only, or no editor yet).
 */
export function focusBody(root: ParentNode | null | undefined, at: BodyCaret): boolean {
  const ed = bodyEditorOf(root)
  if (ed) {
    if (!ed.isEditable) return false
    if (typeof at === 'string') ed.commands.focus(at)
    else ed.chain().setTextSelection({ from: at.anchor, to: at.head }).focus().run()
    // The focus command defers DOM focus a frame; take it now so the next keystroke lands here.
    ed.view.focus()
    return true
  }
  return focusRawBody(root, typeof at === 'string' ? at : null)
}

/** Raw mode: its text area takes the focus, and the caret at `at` (null: where it was). */
function focusRawBody(root: ParentNode | null | undefined, at: 'start' | 'end' | null): boolean {
  const raw = root?.querySelector<HTMLElement>('.object-body-text .cm-content')
  if (!raw || raw.getAttribute('contenteditable') !== 'true') return false
  raw.focus()
  if (at) placeRawCaret(raw, at)
  return true
}

/**
 * M33, choice 1: the caret at the start or the end of the body of the view under `root`, placed
 * for good in this one call (Enter or ArrowDown with nothing focused; an empty note that opens).
 * `focusBody` goes through the editor's focus command, which takes the focus a second time a
 * frame later; here nobody asked from a field, and whatever takes the focus next (a click, the
 * title) must keep it. A change of selection only: nothing is typed, so nothing is saved. False
 * when the body can't take the caret (read-only, or no editor yet).
 */
export function placeBodyCaret(root: ParentNode | null | undefined, at: 'start' | 'end'): boolean {
  const ed = bodyEditorOf(root)
  if (!ed) return focusRawBody(root, at)
  if (!ed.isEditable) return false
  const { doc } = ed.state
  ed.view.dispatch(ed.state.tr.setSelection(at === 'end' ? Selection.atEnd(doc) : Selection.atStart(doc)))
  ed.view.focus()
  // The editor brings the caret into view only once it has the focus (and the focus itself never scrolls).
  ed.view.dispatch(ed.state.tr.scrollIntoView())
  return true
}

/**
 * M33: raw mode takes the caret at the start or the end of its text too. Raw mode's editor
 * (CodeMirror) is loaded only with raw mode, so it is reached through its own module, which is
 * there by the time a raw body exists: the move lands before the next key is read. A change of
 * selection only: nothing is typed, so nothing is saved.
 */
function placeRawCaret(content: HTMLElement, at: 'start' | 'end'): void {
  void import('@codemirror/view')
    .then(({ EditorView }) => {
      const view = EditorView.findFromDOM(content)
      if (!view) return
      view.dispatch({ selection: { anchor: at === 'end' ? view.state.doc.length : 0 }, scrollIntoView: true })
    })
    .catch(() => undefined)
}

/**
 * A click in the empty space below the text: the caret goes to the end of the text. Under a last
 * block that holds no text (an image, a divider, an embed) a new empty line takes it, so there is
 * somewhere to type.
 */
export function focusBodyEnd(root: ParentNode | null | undefined): boolean {
  const ed = bodyEditorOf(root)
  if (ed?.isEditable && !Selection.atEnd(ed.state.doc).$head.parent.isTextblock) {
    ed.chain().insertContentAt(ed.state.doc.content.size, { type: 'paragraph' }).focus('end').run()
    ed.view.focus()
    return true
  }
  return focusBody(root, 'end')
}

/**
 * The caret's document position while nothing is selected (null with a selection), read from the
 * DOM where it is in the editor: the editor's own state follows the DOM selection a moment later,
 * and these keys are read before the editor sees them, so a key pressed right after a caret move
 * (ArrowLeft, ArrowLeft, ArrowUp) must find the caret where it is now.
 */
function caretPosition(ed: TiptapEditor): number | null {
  const sel = ed.view.dom.ownerDocument.getSelection()
  if (sel?.anchorNode && ed.view.dom.contains(sel.anchorNode)) {
    if (!sel.isCollapsed) return null
    try {
      return ed.view.posAtDOM(sel.anchorNode, sel.anchorOffset)
    } catch {
      /* a node the editor can't place: its own selection below */
    }
  }
  return ed.state.selection.empty ? ed.state.selection.from : null
}

/** The caret (nothing selected) is at the body's very first position: there is nowhere to go up to. */
export function caretAtBodyStart(ed: TiptapEditor): boolean {
  const pos = caretPosition(ed)
  return pos !== null && !getBlockSelection(ed.state) && pos <= Selection.atStart(ed.state.doc).from
}

/** The caret's block is a top-level one, so Shift+Tab has nothing to unindent (a list item has). */
export function caretInTopLevelBlock(ed: TiptapEditor): boolean {
  const pos = caretPosition(ed) ?? ed.state.selection.from
  return ed.state.doc.resolve(Math.min(pos, ed.state.doc.content.size)).depth <= 1
}

/**
 * Where the caret of the body under `root` is, when the body has the focus: the formatted
 * editor's selection, or (raw mode) just that the body has it.
 */
export function focusedBodyCaret(root: ParentNode | null | undefined): BodyCaret | null {
  const ed = bodyEditorOf(root)
  if (ed && document.activeElement === ed.view.dom) {
    const { anchor, head } = ed.state.selection
    return { anchor, head }
  }
  const area = root?.querySelector('.object-body-text')
  return area && document.activeElement && area.contains(document.activeElement) ? 'start' : null
}
