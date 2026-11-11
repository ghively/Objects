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

/** The caret (nothing selected) is at the body's very first position: there is nowhere to go up to. */
export function caretAtBodyStart(ed: TiptapEditor): boolean {
  const { selection, doc } = ed.state
  return selection.empty && !getBlockSelection(ed.state) && selection.from <= Selection.atStart(doc).from
}

/** The caret's block is a top-level one, so Shift+Tab has nothing to unindent (a list item has). */
export function caretInTopLevelBlock(ed: TiptapEditor): boolean {
  return ed.state.selection.$from.depth <= 1
}

/** The body's selection, when the body has the focus. */
export function focusedBodySelection(root: ParentNode | null | undefined): { anchor: number; head: number } | null {
  const ed = bodyEditorOf(root)
  if (!ed || document.activeElement !== ed.view.dom) return null
  const { anchor, head } = ed.state.selection
  return { anchor, head }
}

// A rename moves the file, and the page and the peek are keyed by path: the view that had the
// caret is replaced. It leaves the selection here for the view that takes over (one-shot).
const carried = new Map<string, { anchor: number; head: number }>()

/** Leave the body's selection for the view that opens `path` next. */
export function carryCaret(path: string, selection: { anchor: number; head: number }): void {
  carried.set(path, selection)
}

/** Take (and clear) the selection left for `path`, or null. */
export function takeCarriedCaret(path: string): { anchor: number; head: number } | null {
  const sel = carried.get(path) ?? null
  carried.delete(path)
  return sel
}
