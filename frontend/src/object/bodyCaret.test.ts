// focusBodyEnd: a click in the empty space below the text gives the body the caret and the focus
// once, not again a frame later. The chain that starts the new line under a last block that holds
// no text once ended in the editor's focus command ('end'), which takes the DOM focus a second
// time one frame later — focusBody's trap (PR #16): whoever took the focus in that window (a
// title being retyped while its rename answers) lost it again, and that blur committed a
// half-typed title.
import { Editor as TiptapEditor } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { afterEach, describe, expect, test } from 'vitest'
import { focusBodyEnd } from './bodyCaret'

const editors: TiptapEditor[] = []
const mounted: HTMLElement[] = []

afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
  while (mounted.length) mounted.pop()!.remove()
})

/**
 * A formatted body editor whose text ends in a block that holds no text (a divider), in the
 * page's body area. The full kit keeps a trailing paragraph under any such block (its trailing
 * node), which is where the click's caret goes instead — an editor without that guard is the
 * shape the new line under the divider is for.
 */
function bodyEndingInDivider(): { root: HTMLElement; editor: TiptapEditor } {
  const editor = new TiptapEditor({
    extensions: [StarterKit.configure({ trailingNode: false })],
    content: { type: 'doc', content: [{ type: 'paragraph' }, { type: 'horizontalRule' }] },
  })
  editors.push(editor)
  const root = document.createElement('div')
  root.className = 'object-body-text'
  root.appendChild(editor.view.dom)
  document.body.appendChild(root)
  mounted.push(root)
  return { root, editor }
}

describe('focusBodyEnd', () => {
  test('starts a new line under the divider, and the focus is not taken back a frame later', async () => {
    const { root, editor } = bodyEndingInDivider()
    expect(focusBodyEnd(root)).toBe(true)
    // The click did its two things: the body has the focus, and the caret is in a new empty line.
    expect(document.activeElement).toBe(editor.view.dom)
    const last = editor.state.doc.lastChild!
    expect(last.type.name).toBe('paragraph')
    expect(last.content.size).toBe(0)
    expect(editor.state.selection.$from.parent).toBe(last)
    // The title takes the focus next (a retype while its rename answers); a frame later the body
    // must not have taken it back: that blur would commit a half-typed title.
    const title = document.createElement('input')
    document.body.appendChild(title)
    mounted.push(title)
    title.focus()
    expect(document.activeElement).toBe(title)
    await new Promise((r) => requestAnimationFrame(r))
    expect(document.activeElement).toBe(title)
  })
})
