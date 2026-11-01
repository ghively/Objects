/**
 * `codeBlock`: StarterKit's own is turned off and this one registered instead.
 * A Mermaid fence is a code block whose language is `mermaid` (it was a raw
 * block in M1).
 *
 * Options (annotation): `wrap`, `lock`, `preview=edit|split|display`.
 *
 * Task 9: the React node view (`code/CodeBlockView.tsx`: language picker,
 * wrap, lock, copy, download, the Markdown and Mermaid previews) and the lock
 * guard: while a block has `lock`, no transaction may change the text inside
 * it (option changes, moving or deleting the whole block still work).
 *
 * M8 Task 29: syntax highlighting as a decoration plugin (`code/highlight.ts`);
 * the text and bytes never change.
 */
import { CodeBlock as BaseCodeBlock } from '@tiptap/extension-code-block'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, type DecorationSet } from '@tiptap/pm/view'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { buildDecorations, updateDecorations, type DecorationVisitor } from '../extensions/incrementalDecorations'
import type { Option } from '../annotations'
import { codeFence } from '../preserve'
import { CodeBlockView } from '../code/CodeBlockView'
import { codeHighlightPlugin } from '../code/highlight'
import '../../theme/codeSyntax.css'
import './codeBlock.css'

export function isLockedCodeBlock(node: PMNode): boolean {
  if (node.type.name !== 'codeBlock') return false
  const opts = (node.attrs.blockOptions as Option[] | null) ?? []
  return opts.some((o) => o.key === 'lock' && o.value === true)
}

/** The locked code blocks, kept as node decorations so a transaction need not scan the document. */
const lockedVisitor: DecorationVisitor = (node, pos, decos) => {
  if (isLockedCodeBlock(node)) decos.push(Decoration.node(pos, pos + node.nodeSize, {}, { locked: true }))
  return node.type.name !== 'codeBlock' && !node.isTextblock
}

/** The text ranges of the locked code blocks of `state` (from the lock plugin's state, else a scan). */
function lockedRanges(state: EditorState): [number, number][] {
  const set = CodeBlockLockKey.getState(state) ?? buildDecorations(state.doc, lockedVisitor)
  return set.find().map((d) => [d.from + 1, d.to - 1])
}

/** Whether `tr` changes text strictly inside a locked code block of `state`. */
export function touchesLockedCode(tr: Transaction, state: EditorState): boolean {
  if (!tr.docChanged) return false
  const locked = lockedRanges(state)
  if (!locked.length) return false
  let hit = false
  tr.steps.forEach((step, i) => {
    if (hit) return
    const before = tr.mapping.slice(0, i)
    const ranges = locked.map(([s, e]) => [before.map(s, 1), before.map(e, -1)] as const)
    step.getMap().forEach((from, to) => {
      if (ranges.some(([s, e]) => from >= s && to <= e)) hit = true
    })
  })
  return hit
}

export const CodeBlockLockKey = new PluginKey<DecorationSet>('codeBlockLock')

/** The fence for `text` (`preserve.ts`): three backticks, or more when a line inside would close it. */
export { codeFence }

export const CodeBlock = BaseCodeBlock.extend({
  renderMarkdown: (node, h) => {
    const language = node.attrs?.language || ''
    if (!node.content) return `\`\`\`${language}\n\n\`\`\``
    const text = h.renderChildren(node.content)
    const fence = codeFence(text)
    return [fence + language, text, fence].join('\n')
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin<DecorationSet>({
        key: CodeBlockLockKey,
        state: {
          init: (_, state) => buildDecorations(state.doc, lockedVisitor),
          apply: (tr, old) => updateDecorations(old, tr, lockedVisitor),
        },
        filterTransaction: (tr, state) => !touchesLockedCode(tr, state),
      }),
      codeHighlightPlugin(this.name),
    ]
  },
})
