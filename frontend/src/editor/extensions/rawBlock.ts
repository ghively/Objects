/**
 * `rawBlock`: a top-level block whose Markdown source the editor does not model
 * (HTML, `Field::` lines, Mermaid, anything that does not round-trip cleanly).
 * It shows the source as monospace text that stays editable; its text is the
 * block's Markdown, emitted as-is on save.
 */
import { Node } from '@tiptap/core'

export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'pre[data-raw-block]', preserveWhitespace: 'full' }]
  },

  renderHTML() {
    return [
      'pre',
      { 'data-raw-block': '', class: 'raw-block', spellcheck: 'false' },
      ['code', 0],
    ]
  },

  renderMarkdown(node: { content?: { text?: string }[] }) {
    return (node.content ?? []).map((c) => c.text ?? '').join('')
  },
})
