/**
 * Paste as plain text (`pasteAsPlainText`, Ctrl+Shift+V; the catalog's Text editing group).
 *
 * The key's handler (`armPlainPaste`, bound from the registry by `editor/shortcuts.ts`) only
 * arms the next paste and lets the browser fire its paste event; `handlePaste` then inserts the
 * clipboard's `text/plain` as text (lines become paragraphs, blank lines are dropped), ignoring
 * any HTML and reading no Markdown. The arming lasts until the key is released, so a plain
 * Ctrl+V afterwards pastes normally again.
 */
import { Extension } from '@tiptap/core'
import { Fragment, Slice } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

let armed = false

/** Make the next paste a plain-text one (the key's handler). */
export function armPlainPaste(): void {
  armed = true
}

/** Insert `text` as plain text at the selection: one paragraph per line. */
export function pastePlainText(view: EditorView, text: string): boolean {
  const lines = text.split(/(?:\r\n?|\n)+/).filter((line) => line.length > 0)
  if (lines.length === 0) return false
  const { schema } = view.state
  const paragraphs = lines.map((line) => schema.nodes.paragraph.create(null, schema.text(line)))
  const slice = new Slice(Fragment.from(paragraphs), 1, 1)
  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'))
  return true
}

export const pasteAsPlainTextKey = new PluginKey('pasteAsPlainText')

export const PasteAsPlainText = Extension.create({
  name: 'pasteAsPlainText',
  // Before `BlockSelection` (900), whose paste reads Markdown blocks out of the clipboard's text.
  priority: 950,

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: pasteAsPlainTextKey,
        props: {
          handleDOMEvents: {
            keyup: () => {
              armed = false
              return false
            },
          },
          handlePaste(view, event) {
            if (!armed) return false
            armed = false
            if (!editor.isEditable) return false
            const data = event.clipboardData
            if (!data || (data.files && data.files.length > 0)) return false
            const text = data.getData('text/plain') || data.getData('Text')
            if (!text) return false
            event.preventDefault()
            return pastePlainText(view, text)
          },
        },
      }),
    ]
  },
})
