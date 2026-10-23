/**
 * The editor's document model: load a Markdown body into Tiptap with every
 * top-level block stamped with its source, and serialize it back so that
 * unedited blocks come out byte-for-byte.
 */
import type { AnyExtension, Editor, JSONContent } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'
import type { Node as PMNode } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { splitBlocks, type SourceBlock } from './blocks'
import { serializeWithPreservation, type EditorBlock } from './preserve'
import { BLOCK_SOURCE_META, BlockSource } from './extensions/blockSource'
import { RawBlock } from './extensions/rawBlock'
import { Wikilink } from './extensions/wikilink'

export function editorExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Markdown,
    BlockSource,
    RawBlock,
    Wikilink,
  ]
}

/** Per-editor source that lives outside the node tree. */
type Edges = { leading: string; trailing: string }
const edges = new WeakMap<Editor, Edges>()

const FIELD_LINE = /^[^\s:][^:\n]*::/m
const RAW_KINDS = new Set(['html', 'def', 'raw', 'text'])

const NODE_KIND: Record<string, string> = {
  paragraph: 'paragraph',
  heading: 'heading',
  bulletList: 'list',
  orderedList: 'list',
  taskList: 'list',
  table: 'table',
  codeBlock: 'code',
  blockquote: 'blockquote',
  horizontalRule: 'hr',
  rawBlock: 'raw',
}

/** Loose comparison used to decide whether Tiptap parsed a block without losing anything. */
function contentKey(md: string): string {
  return md
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]*(?:[*+-]|\d{1,9}[.)])[ \t]+/gm, '')
    .replace(/[\s*_`~\\#=+-]/g, '')
}

function trimBreaks(s: string): string {
  return s.replace(/^(?:\r?\n|\r)+|(?:\r?\n|\r)+$/g, '')
}

function rawNode(raw: string): JSONContent {
  const text = trimBreaks(raw).replace(/\r\n?/g, '\n')
  return text ? { type: 'rawBlock', content: [{ type: 'text', text }] } : { type: 'rawBlock' }
}

function sourceToNode(editor: Editor, block: SourceBlock): JSONContent {
  const md = editor.markdown
  if (!md || RAW_KINDS.has(block.kind) || FIELD_LINE.test(block.raw)) return rawNode(block.raw)
  if (block.kind === 'code' && /^\s*(```|~~~)\s*mermaid\b/i.test(block.raw)) return rawNode(block.raw)
  try {
    const parsed = md.parse(block.raw.replace(/\r\n?/g, '\n'))
    const nodes = parsed.content ?? []
    if (nodes.length !== 1) return rawNode(block.raw)
    const node = nodes[0]
    editor.schema.nodeFromJSON(node).check()
    const regenerated = md.serialize({ type: 'doc', content: [node] })
    if (contentKey(regenerated) !== contentKey(block.raw)) return rawNode(block.raw)
    return node
  } catch {
    return rawNode(block.raw)
  }
}

/** Replace the editor's document with `body`. The load is not undoable and fires no update. */
export function loadBody(editor: Editor, body: string): void {
  const blocks = splitBlocks(body)
  let leading = ''
  let trailing = ''
  if (blocks.length && blocks[0].kind === 'space') leading = blocks.shift()!.raw
  if (blocks.length && blocks[blocks.length - 1].kind === 'space') trailing = blocks.pop()!.raw

  const content: JSONContent[] = []
  for (const block of blocks) {
    if (block.kind === 'space') {
      const prev = content[content.length - 1]
      if (prev) prev.attrs = { ...prev.attrs, blockTrailing: (prev.attrs?.blockTrailing ?? '') + block.raw }
      else leading += block.raw
      continue
    }
    const node = sourceToNode(editor, block)
    node.attrs = { ...node.attrs, blockSource: block.raw, blockOrigin: block.raw }
    content.push(node)
  }
  if (content.length === 0) content.push({ type: 'paragraph' })

  const doc = editor.schema.nodeFromJSON({ type: 'doc', content })
  const { state } = editor
  const tr = state.tr
    .replaceWith(0, state.doc.content.size, doc.content)
    .setMeta(BLOCK_SOURCE_META, true)
    .setMeta('addToHistory', false)
    .setMeta('preventUpdate', true)
  editor.view.dispatch(tr)
  edges.set(editor, { leading, trailing })
}

/**
 * What the serializer emits for `raw` unedited: the baseline `preserveBlock`
 * compares an edited block's lines against, so only edited lines change.
 */
function baselineOf(editor: Editor, raw: string, kind: string): string | undefined {
  const md = editor.markdown
  if (!md || kind === 'raw') return undefined
  try {
    const nodes = md.parse(raw.replace(/\r\n?/g, '\n')).content ?? []
    if (nodes.length !== 1) return undefined
    return trimBreaks(md.serialize({ type: 'doc', content: [nodes[0]] }))
  } catch {
    return undefined
  }
}

function nodeMarkdown(editor: Editor, node: PMNode): string {
  if (node.type.name === 'rawBlock') return node.textContent
  const json = node.toJSON() as JSONContent
  return trimBreaks(editor.markdown?.serialize({ type: 'doc', content: [json] }) ?? '')
}

/** Serialize the document, re-emitting every unedited block's original source. */
export function serializeBody(editor: Editor): string {
  const { leading, trailing } = edges.get(editor) ?? { leading: '', trailing: '' }
  const blocks: EditorBlock[] = []
  if (leading) blocks.push({ raw: leading, markdown: leading, kind: 'space' })
  editor.state.doc.forEach((node) => {
    const source = node.attrs.blockSource as string | null | undefined
    const origin = node.attrs.blockOrigin as string | null | undefined
    const kind = NODE_KIND[node.type.name] ?? node.type.name
    if (source != null) {
      blocks.push({ raw: source, markdown: source, kind })
    } else {
      const markdown = nodeMarkdown(editor, node)
      if (origin != null) blocks.push({ raw: origin, markdown, kind, baseline: baselineOf(editor, origin, kind) })
      else if (markdown !== '') blocks.push({ markdown, kind })
    }
    const after = node.attrs.blockTrailing as string | null | undefined
    if (after) blocks.push({ raw: after, markdown: after, kind: 'space' })
  })
  if (trailing) blocks.push({ raw: trailing, markdown: trailing, kind: 'space' })
  return serializeWithPreservation(blocks)
}
