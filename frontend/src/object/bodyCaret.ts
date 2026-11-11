/**
 * M32: the caret between a note's title and its body (item 2), and where a body-focus request
 * puts it. The body editor's handle (`BodyEditorHandle`) has no focus or caret call, so this
 * reaches the formatted editor through its DOM node (Tiptap keeps the editor on `.ProseMirror`,
 * as the inline view's own focus already reads it); raw mode only takes the focus.
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
  const raw = root?.querySelector<HTMLElement>('.object-body-text .cm-content')
  if (!raw || raw.getAttribute('contenteditable') !== 'true') return false
  raw.focus()
  return true
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
