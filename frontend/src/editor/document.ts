/**
 * The editor's document model: load a Markdown body into Tiptap with every
 * block stamped with its source, and serialize it back so that unedited
 * blocks come out byte-for-byte.
 *
 * M7: the body is grouped into a tree first (`buildTree`): annotated leaves
 * carry their options (`blockOptions`, `blockAnnotation`), and containers
 * (toggle, group, columns) load with their children, each child stamped with
 * its own source. Serializing recurses into containers; an unedited container
 * is emitted as its whole region.
 */
import type { AnyExtension, Editor, JSONContent } from '@tiptap/core'
import { OrderedList, TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'
import type { Node as PMNode } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import {
  classifyEmbedLine,
  formatAnnotation,
  optionsEqual,
  parseAnnotation,
  singleLink,
  type Option,
} from './annotations'
import { splitBlocks, type SourceBlock } from './blocks'
import { buildTree, flattenTree, type TreeNode } from './blockTree'
import { preserveBlock, serializeWithPreservation, type EditorBlock } from './preserve'
import {
  BLOCK_SOURCE_META,
  BlockSource,
  contentMatchesSnapshot,
  takeSnapshots,
} from './extensions/blockSource'
import { BlockSelection } from './extensions/blockSelection'
import { FileDrop } from './extensions/fileDrop'
import { RawBlock } from './extensions/rawBlock'
import { SlashMenu } from './extensions/slashMenu'
import { Wikilink } from './extensions/wikilink'
import { BlockOptions } from './nodes/blockOptions'
import { Bookmark, bookmarkMarkdown } from './nodes/bookmark'
import { CodeBlock } from './nodes/codeBlock'
import { Column, Columns } from './nodes/columns'
import { Group } from './nodes/group'
import { InlineMath } from './nodes/inlineMath'
import { MathBlock, mathBlockMarkdown, mathBlockText } from './nodes/mathBlock'
import { Media, mediaAttrs, mediaMarkdown, type MediaAttrs } from './nodes/media'
import { ObjectEmbed, objectEmbedMarkdown } from './nodes/objectEmbed'
import { Toggle } from './nodes/toggle'

export type EditorExtensionOptions = {
  /** `false` leaves out the "1. " input rule (`EditorSettings.disableNumberedListTransformation`). */
  numberedListInputRule?: boolean
}

export function editorExtensions(opts: EditorExtensionOptions = {}): AnyExtension[] {
  const numbered = opts.numberedListInputRule ?? true
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false },
      codeBlock: false,
      orderedList: false,
    }),
    numbered ? OrderedList : OrderedList.extend({ addInputRules: () => [] }),
    CodeBlock,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Markdown,
    BlockSource,
    BlockOptions,
    RawBlock,
    Wikilink,
    InlineMath,
    MathBlock,
    Media,
    ObjectEmbed,
    Bookmark,
    Toggle,
    Group,
    Columns,
    Column,
    SlashMenu,
    BlockSelection,
    FileDrop,
  ]
}

/** Per-editor source that lives outside the node tree. */
type Edges = { leading: string; trailing: string; eol: string }
const edges = new WeakMap<Editor, Edges>()

const FIELD_LINE = /^[^\s:][^:\n]*::/m
const RAW_KINDS = new Set(['html', 'def', 'raw', 'text'])
const CONTAINERS = new Set(['toggle', 'group', 'columns'])
/** Leaf types whose Markdown this module writes itself (`customMarkdown`). */
const CUSTOM_TYPES = new Set(['mathBlock', 'media', 'objectEmbed', 'bookmark'])

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
  mathBlock: 'math',
  media: 'media',
  objectEmbed: 'objectEmbed',
  bookmark: 'bookmark',
  toggle: 'container',
  group: 'container',
  columns: 'container',
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

const hasFlag = (options: readonly Option[] | undefined, key: string) =>
  (options ?? []).some((o) => o.key === key && o.value === true)

/** The node for one source block; `options` are its annotation's (for the web link block). */
function sourceToNode(editor: Editor, block: SourceBlock, options?: readonly Option[]): JSONContent {
  if (block.kind === 'math') return { type: 'mathBlock', attrs: { text: mathBlockText(block.raw) } }
  if (block.kind === 'paragraph') {
    const embed = classifyEmbedLine(block.raw)
    if (embed?.kind === 'image')
      return { type: 'media', attrs: mediaAttrs({ form: 'md', src: embed.src, alt: embed.alt }) }
    if (embed?.kind === 'media')
      return {
        type: 'media',
        attrs: mediaAttrs({ form: 'wiki', target: embed.target, label: embed.label, kind: embed.mediaKind }),
      }
    if (embed?.kind === 'objectEmbed')
      return { type: 'objectEmbed', attrs: { target: embed.target, label: embed.label } }
    if (hasFlag(options, 'bookmark')) {
      const link = singleLink(block.raw)
      if (link) return { type: 'bookmark', attrs: { href: link.href, title: link.title } }
    }
  }
  const md = editor.markdown
  if (!md || RAW_KINDS.has(block.kind) || FIELD_LINE.test(block.raw)) return rawNode(block.raw)
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

/** Source of a tree node, exactly as read. */
function regionRaw(node: TreeNode): string {
  return flattenTree([node])
    .map((b) => b.raw)
    .join('')
}

type Loaded = { content: JSONContent[]; leading: string }

/** Load a list of tree nodes; blank-line blocks go to the previous node's `blockTrailing`. */
function loadList(editor: Editor, nodes: TreeNode[]): Loaded {
  const content: JSONContent[] = []
  let leading = ''
  for (const node of nodes) {
    if (node.kind === 'leaf' && node.block.kind === 'space') {
      const prev = content[content.length - 1]
      if (prev) prev.attrs = { ...prev.attrs, blockTrailing: (prev.attrs?.blockTrailing ?? '') + node.block.raw }
      else leading += node.block.raw
      continue
    }
    content.push(node.kind === 'leaf' ? loadLeaf(editor, node) : loadContainer(editor, node))
  }
  return { content, leading }
}

function loadLeaf(editor: Editor, node: Extract<TreeNode, { kind: 'leaf' }>): JSONContent {
  const { block, annotation } = node
  const json = sourceToNode(editor, block, annotation?.parsed.options)
  json.attrs = { ...json.attrs, blockSource: block.raw, blockOrigin: block.raw }
  if (annotation) {
    json.attrs.blockAnnotation = annotation.raw
    json.attrs.blockOptions = annotation.parsed.options
  }
  return json
}

const placeholder = (): JSONContent => ({ type: 'paragraph' })

function loadContainer(editor: Editor, node: Extract<TreeNode, { kind: 'container' }>): JSONContent {
  const raw = regionRaw(node)
  const attrs: Record<string, unknown> = {
    blockSource: raw,
    blockOrigin: raw,
    blockOptions: node.open.parsed.options,
    containerOpen: node.open.raw,
    containerClose: node.close.raw,
  }
  if (node.name === 'columns') {
    const content = node.columns.map((list, c) => {
      const loaded = loadList(editor, list)
      const sep = node.separators[c] ?? null
      const colRaw = (sep ?? '') + flattenTree(list).map((b) => b.raw).join('')
      return {
        type: 'column',
        attrs: {
          separator: sep,
          containerLeading: loaded.leading || null,
          blockSource: colRaw,
          blockOrigin: colRaw,
        },
        content: loaded.content.length ? loaded.content : [placeholder()],
      }
    })
    return { type: 'columns', attrs, content }
  }
  const loaded = loadList(editor, node.columns[0] ?? [])
  attrs.containerLeading = loaded.leading || null
  return { type: node.name, attrs, content: loaded.content.length ? loaded.content : [placeholder()] }
}

/** Replace the editor's document with `body`. The load is not undoable and fires no update. */
export function loadBody(editor: Editor, body: string): void {
  const blocks = splitBlocks(body)
  let leading = ''
  let trailing = ''
  if (blocks.length && blocks[0].kind === 'space') leading = blocks.shift()!.raw
  if (blocks.length && blocks[blocks.length - 1].kind === 'space') trailing = blocks.pop()!.raw

  const loaded = loadList(editor, buildTree(blocks))
  leading += loaded.leading
  const content = loaded.content
  if (content.length === 0) content.push({ type: 'paragraph' })

  const doc = editor.schema.nodeFromJSON({ type: 'doc', content })
  const { state } = editor
  const tr = state.tr
    .replaceWith(0, state.doc.content.size, doc.content)
    .setMeta(BLOCK_SOURCE_META, true)
    .setMeta('addToHistory', false)
    .setMeta('preventUpdate', true)
  editor.view.dispatch(tr)
  takeSnapshots(editor, editor.state.doc)
  edges.set(editor, { leading, trailing, eol: body.includes('\r\n') ? '\r\n' : '\n' })
}

// ---------------------------------------------------------------------------
// Serializing

/** Markdown of the leaf node types this module builds itself (not through `@tiptap/markdown`). */
function customMarkdown(json: JSONContent): string | null {
  const a = (json.attrs ?? {}) as Record<string, unknown>
  switch (json.type) {
    case 'mathBlock':
      return mathBlockMarkdown(String(a.text ?? ''))
    case 'media':
      return mediaMarkdown(a as Partial<MediaAttrs>)
    case 'objectEmbed':
      return objectEmbedMarkdown(String(a.target ?? ''), a.label as string | null)
    case 'bookmark':
      return bookmarkMarkdown(String(a.href ?? ''), a.title as string | null)
    default:
      return null
  }
}

/**
 * What the serializer emits for `raw` unedited: the baseline `preserveBlock`
 * compares an edited block's lines against, so only edited lines change.
 */
function baselineOf(editor: Editor, raw: string, kind: string, node: PMNode): string | undefined {
  if (kind === 'raw') return undefined
  const options = (node.attrs.blockOptions as Option[] | null) ?? undefined
  const block: SourceBlock = { kind: kind === 'math' ? 'math' : 'paragraph', raw }
  if (CUSTOM_TYPES.has(node.type.name)) {
    const json = sourceToNode(editor, block, options)
    const md = customMarkdown(json)
    return md === null ? undefined : md
  }
  const md = editor.markdown
  if (!md) return undefined
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
  const custom = customMarkdown(json)
  if (custom !== null) return custom
  return trimBreaks(editor.markdown?.serialize({ type: 'doc', content: [json] }) ?? '')
}

/** The annotation line for a leaf: the original while its options are unchanged, else canonical. */
function leafAnnotation(node: PMNode, eol: string): string {
  const options = (node.attrs.blockOptions as Option[] | null) ?? []
  const original = node.attrs.blockAnnotation as string | null
  if (original != null) {
    const parsed = parseAnnotation(original)
    if (parsed && optionsEqual(options, parsed.options)) return original
  }
  if (options.length === 0) return ''
  return formatAnnotation({ type: 'leaf', options }) + (original != null ? lineEndOf(original, eol) || eol : eol)
}

/** The open line for a container: the original while its options are unchanged, else canonical. */
function containerOpenLine(node: PMNode, eol: string): string {
  const options = (node.attrs.blockOptions as Option[] | null) ?? []
  const original = node.attrs.containerOpen as string | null
  if (original != null) {
    const parsed = parseAnnotation(original)
    if (parsed && optionsEqual(options, parsed.options)) return original
  }
  return formatAnnotation({ type: 'open', name: node.type.name as 'toggle', options }) + lineEndOf(original, eol)
}

/** The line end `original` had (none when a blank line followed it), or `eol` for a new line. */
function lineEndOf(original: string | null, eol: string): string {
  if (original == null) return eol
  return /(?:\r\n|\n|\r)$/.exec(original)?.[0] ?? ''
}

const endsWithBreak = (s: string) => /(?:\r\n|\n|\r)$/.test(s)

/** One block (leaf or container) as a `serializeWithPreservation` entry, or `null` for nothing. */
function nodeEntry(editor: Editor, node: PMNode, eol: string): EditorBlock | null {
  const source = node.attrs.blockSource as string | null | undefined
  const origin = node.attrs.blockOrigin as string | null | undefined
  const kind = NODE_KIND[node.type.name] ?? node.type.name

  if (CONTAINERS.has(node.type.name)) {
    if (source != null) return { raw: source, markdown: source, kind }
    const text = containerText(editor, node, eol)
    return origin != null ? { raw: text, markdown: text, kind } : { markdown: text, kind }
  }

  const annotation = leafAnnotation(node, eol)
  let text: string | null = null
  if (source != null) text = source
  else if (origin != null) {
    if (contentMatchesSnapshot(editor, node)) text = origin
    else {
      const markdown = nodeMarkdown(editor, node)
      text = preserveBlock(origin, markdown, kind, eol, baselineOf(editor, origin, kind, node))
    }
  }
  if (text !== null) {
    const raw = annotation + text
    return raw === '' ? null : { raw, markdown: raw, kind }
  }
  const markdown = nodeMarkdown(editor, node)
  if (markdown === '') return null
  return { markdown: annotation + markdown, kind }
}

/** Serialize a list of sibling blocks (with their blank lines) into one string. */
function listText(editor: Editor, parent: PMNode, eol: string, dropLastTrailing: boolean): string {
  const blocks: EditorBlock[] = []
  parent.forEach((child, _offset, index) => {
    const entry = nodeEntry(editor, child, eol)
    if (entry) blocks.push(entry)
    const after = child.attrs.blockTrailing as string | null | undefined
    if (after && !(dropLastTrailing && index === parent.childCount - 1))
      blocks.push({ raw: after, markdown: after, kind: 'space' })
  })
  return serializeWithPreservation(blocks, eol)
}

/** An edited or new container: open line, leading blanks, children, separators, close line. */
function containerText(editor: Editor, node: PMNode, eol: string): string {
  const isNew = node.attrs.blockOrigin == null
  let out = containerOpenLine(node, eol)
  const closeBefore = () => {
    if (out !== '' && !endsWithBreak(out)) out += eol
  }
  if (node.type.name === 'columns') {
    node.forEach((column, _offset, index) => {
      if (index > 0) {
        closeBefore()
        out += (column.attrs.separator as string | null) ?? formatAnnotation({ type: 'separator', options: [] }) + eol
      }
      out += (column.attrs.containerLeading as string | null) ?? ''
      out += listText(editor, column, eol, isNew || column.attrs.blockOrigin == null)
    })
  } else {
    out += (node.attrs.containerLeading as string | null) ?? ''
    out += listText(editor, node, eol, isNew)
  }
  closeBefore()
  const close = node.attrs.containerClose as string | null
  return out + (close ?? formatAnnotation({ type: 'close', name: node.type.name as 'toggle', options: [] }))
}

/** Serialize the document, re-emitting every unedited block's original source. */
export function serializeBody(editor: Editor): string {
  const { leading, trailing, eol } = edges.get(editor) ?? { leading: '', trailing: '', eol: '\n' }
  const blocks: EditorBlock[] = []
  if (leading) blocks.push({ raw: leading, markdown: leading, kind: 'space' })
  editor.state.doc.forEach((node) => {
    const entry = nodeEntry(editor, node, eol)
    if (entry) blocks.push(entry)
    const after = node.attrs.blockTrailing as string | null | undefined
    if (after) blocks.push({ raw: after, markdown: after, kind: 'space' })
  })
  if (trailing) blocks.push({ raw: trailing, markdown: trailing, kind: 'space' })
  return serializeWithPreservation(blocks, edges.has(editor) ? eol : undefined)
}
