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
 *
 * M8 adds inline colour and highlight marks, date tokens, list-item option
 * comments, the `indent` container, block references and collection / query
 * embeds (each in `nodes/`); every one round-trips under the same byte rules.
 *
 * M14 adds the button block (`nodes/buttonBlock.ts`): `<!-- block: button rule="<id>" -->` on a
 * one-line paragraph, its label.
 */
import { getExtensionField, type AnyExtension, type Editor, type JSONContent } from '@tiptap/core'
import { OrderedList, TaskItem } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
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
import { buildTree, flattenTree, isOneLine, type TreeNode } from './blockTree'
import { preserveBlock, serializeWithPreservation, type EditorBlock } from './preserve'
import {
  BLOCK_SOURCE_META,
  BlockSource,
  contentMatchesSnapshot,
  takeSnapshots,
} from './extensions/blockSource'
import { BlockSelection } from './extensions/blockSelection'
import { FileDrop } from './extensions/fileDrop'
import { MarkdownShortcuts } from './extensions/markdownShortcuts'
import { RawBlock } from './extensions/rawBlock'
import { SlashMenu } from './extensions/slashMenu'
import { TaskListCommonMark, withTaskItems } from './extensions/taskListMarkdown'
import { Wikilink } from './extensions/wikilink'
import { BlockOptions, optionApplies } from './nodes/blockOptions'
import { Bookmark, bookmarkMarkdown } from './nodes/bookmark'
import { ButtonBlock, buttonBlockMarkdown, buttonLabelOf } from './nodes/buttonBlock'
import { CodeBlock } from './nodes/codeBlock'
import { Column, Columns } from './nodes/columns'
import { Group } from './nodes/group'
import { InlineMath } from './nodes/inlineMath'
import { MathBlock, mathBlockMarkdown, mathBlockText } from './nodes/mathBlock'
import { Media, mediaAttrs, mediaMarkdown, type MediaAttrs } from './nodes/media'
import { ObjectEmbed, objectEmbedMarkdown } from './nodes/objectEmbed'
import { Toggle } from './nodes/toggle'
import { BlockRef } from './nodes/blockRef'
import { DataViewEmbed, dataViewEmbedMarkdown } from './nodes/dataViewEmbed'
import { DateToken } from './nodes/dateToken'
import { Indent } from './nodes/indent'
import { ListItemOptions, ListItemOptionsLine } from './nodes/listItemOptions'
import { Highlight, TextColor } from './nodes/textStyle'
import { blockRefMarkdown } from './blocks'
import { M8Keys } from './shortcuts'
import { withTextEscapes } from './textEscapes'
import { NbspEntity, withLinkForms } from './extensions/linkForms'
import { RecordAudio } from './media/recordAudio'
import { LazyTable } from './table/LazyTable'

export type EditorExtensionOptions = {
  /** `false` leaves out the "1. " input rule. */
  numberedListInputRule?: boolean
  /** The editor holds one paragraph (a Text property cell): pasted text is never read as Markdown blocks. */
  singleParagraph?: boolean
}

/**
 * Built-in Tiptap keys whose action the shortcut registry owns (`lib/shortcuts.ts`, bound in
 * `extensions/blockSelection.ts`): they are taken out of the built-in key maps so that only the
 * registry's keys trigger those actions, and a key corrected in the registry leaves no old key
 * behind. Other built-in keys (Enter, Backspace, Mod-z, Mod-Shift-8, …) stay.
 */
const REGISTRY_OWNED_KEYS: Record<string, (key: string) => boolean> = {
  bold: (k) => k === 'Mod-b' || k === 'Mod-B',
  italic: (k) => k === 'Mod-i' || k === 'Mod-I',
  underline: (k) => k === 'Mod-u' || k === 'Mod-U',
  strike: (k) => k === 'Mod-Shift-s' || k === 'Mod-Shift-S',
  code: (k) => k === 'Mod-e' || k === 'Mod-E',
  heading: (k) => /^Mod-Alt-\d$/.test(k),
  codeBlock: (k) => k === 'Mod-Alt-c',
  taskList: (k) => k === 'Mod-Shift-9',
  listItem: (k) => k === 'Tab' || k === 'Shift-Tab',
  taskItem: (k) => k === 'Tab' || k === 'Shift-Tab',
  // Not a registry action: Ctrl+Shift+B is reserved for "Show/hide shortcuts menu".
  blockquote: (k) => k === 'Mod-Shift-b' || k === 'Mod-Shift-B',
}

/** `ext` without the built-in keys the registry owns (unchanged when it has none). */
export function withoutRegistryKeys<T extends AnyExtension>(ext: T): T {
  const owned = REGISTRY_OWNED_KEYS[ext.name]
  if (!owned) return ext
  const stripped = ext.extend({
    addKeyboardShortcuts() {
      const { parent: _parent, ...context } = this
      const keys = getExtensionField<() => Record<string, unknown>>(ext, 'addKeyboardShortcuts', context)
      const all = (typeof keys === 'function' ? keys() : {}) ?? {}
      return Object.fromEntries(Object.entries(all).filter(([key]) => !owned(key)))
    },
  }) as T
  // As `configure` does: the copied config's other fields keep `ext`'s parent chain (with `ext`
  // as the parent they would run twice, e.g. a keyed plugin added twice).
  stripped.parent = ext.parent
  return stripped
}

/**
 * StarterKit with the registry-owned keys taken out of each of its extensions,
 * and paragraphs and headings escaping text that would read as other Markdown.
 */
const RegistryStarterKit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map(withoutRegistryKeys).map(withTextEscapes).map(withLinkForms).map(withTaskItems)
  },
})

export function editorExtensions(opts: EditorExtensionOptions = {}): AnyExtension[] {
  const numbered = opts.numberedListInputRule ?? true
  return [
    RegistryStarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false },
      codeBlock: false,
      orderedList: false,
    }),
    numbered ? OrderedList : OrderedList.extend({ addInputRules: () => [] }),
    withoutRegistryKeys(CodeBlock),
    withoutRegistryKeys(TaskListCommonMark),
    withoutRegistryKeys(TaskItem.configure({ nested: true })),
    TableKit.configure({ table: false }),
    LazyTable.configure({ resizable: false }),
    Markdown,
    BlockSource,
    BlockOptions,
    RawBlock,
    Wikilink,
    InlineMath,
    NbspEntity,
    MathBlock,
    Media,
    ObjectEmbed,
    Bookmark,
    Toggle,
    Group,
    Columns,
    Column,
    // M8
    TextColor,
    Highlight,
    DateToken,
    ListItemOptions,
    ListItemOptionsLine,
    Indent,
    BlockRef,
    DataViewEmbed,
    // M14
    ButtonBlock,
    RecordAudio,
    SlashMenu,
    BlockSelection.configure({ markdownPaste: !opts.singleParagraph }),
    M8Keys,
    FileDrop,
    MarkdownShortcuts.configure({ numbered }),
  ]
}

/**
 * Per-editor source that lives outside the node tree. `final` is the line
 * break the body ended with ('' when it had none), kept on save.
 */
type Edges = { leading: string; trailing: string; eol: string; final: string }
const edges = new WeakMap<Editor, Edges>()

/**
 * A `Key:: value` field line (kept raw). The `::` is followed by a blank or the
 * line end, so `std::vector` or `a::b` in text is not one; `Key\:: value` is
 * the escaped text the editor writes for a typed one (`escapeLineStarts`).
 */
const FIELD_LINE = /^[^\s:][^:\n]*(?<!\\)::(?:[ \t]|$)/m
const RAW_KINDS = new Set(['html', 'def', 'raw', 'text'])
const CONTAINERS = new Set(['toggle', 'group', 'columns', 'indent'])
/** Leaf types whose Markdown this module writes itself (`customMarkdown`). */
const CUSTOM_TYPES = new Set(['mathBlock', 'media', 'objectEmbed', 'bookmark', 'blockRef', 'dataViewEmbed', 'buttonBlock'])

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
  blockRef: 'blockRef',
  dataViewEmbed: 'dataView',
  buttonBlock: 'button',
  toggle: 'container',
  group: 'container',
  columns: 'container',
  indent: 'container',
}

/** Loose comparison used to decide whether Tiptap parsed a block without losing anything. */
function contentKey(md: string): string {
  return md
    .replace(/\r\n?/g, '\n')
    .replace(/\[X\]/g, '[x]') // a done box either way
    .replace(/^[ \t]*(?:>[ \t]?)+/gm, '')
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
    if (embed?.kind === 'blockRef')
      return { type: 'blockRef', attrs: { target: embed.target, id: embed.id, label: embed.label } }
    if (embed?.kind === 'dataView')
      return { type: 'dataViewEmbed', attrs: { kind: embed.dataKind, id: embed.id, label: embed.label } }
    if (hasFlag(options, 'bookmark')) {
      const link = singleLink(block.raw)
      if (link) return { type: 'bookmark', attrs: { href: link.href, title: link.title } }
    }
    // M14: a button block, its one line the label (kept as written).
    if (hasFlag(options, 'button') && isOneLine(block.raw))
      return { type: 'buttonBlock', attrs: { label: buttonLabelOf(block.raw) } }
  }
  const md = editor.markdown
  if (!md || RAW_KINDS.has(block.kind) || FIELD_LINE.test(block.raw)) return rawNode(block.raw)
  const cache = parseCacheOf(editor)
  const key = block.kind + '\0' + block.raw
  const hit = cache.map.get(key)
  if (hit) {
    // Most recently used last; a copy, since the caller adds its attributes.
    cache.map.delete(key)
    cache.map.set(key, hit)
    return { ...hit, attrs: hit.attrs ? { ...hit.attrs } : undefined }
  }
  const node = parseSourceBlock(editor, block)
  remember(cache, key, node, block.raw.length)
  return { ...node, attrs: node.attrs ? { ...node.attrs } : undefined }
}

function parseSourceBlock(editor: Editor, block: SourceBlock): JSONContent {
  const md = editor.markdown!
  try {
    const parsed = md.parse(block.raw.replace(/\r\n?/g, '\n'))
    const nodes = parsed.content ?? []
    if (nodes.length !== 1) return rawNode(block.raw)
    const node = nodes[0]
    editor.schema.nodeFromJSON(node).check()
    // Did the parse lose anything? Plain text needs no serializing to tell (F9).
    const plain = plainTextOf(node)
    const regenerated = plain ?? md.serialize({ type: 'doc', content: [node] })
    if (contentKey(regenerated) !== contentKey(block.raw)) return rawNode(block.raw)
    return node
  } catch {
    return rawNode(block.raw)
  }
}

/**
 * The text of a paragraph or heading made of unmarked text (and hard breaks)
 * whose serialized form differs from it only by backslash escapes and the
 * heading marks, which `contentKey` ignores; null for anything else (marks,
 * atoms, characters the serializer encodes: entities, dollars, a non-breaking
 * space; or a line starting like a list item or a quote, which `contentKey`
 * would strip from the bare text but not from the escaped form).
 */
function plainTextOf(node: JSONContent): string | null {
  if (node.type !== 'paragraph' && node.type !== 'heading') return null
  let text = ''
  for (const n of node.content ?? []) {
    if (n.type === 'hardBreak') text += '\n'
    else if (n.type === 'text' && !n.marks?.length) text += n.text ?? ''
    else return null
  }
  return /[&<>$\u00a0]/.test(text) || /^[ \t]*(?:[*+-]|\d{1,9}[.)]|>)(?:[ \t]|$)/m.test(text) ? null : text
}

/**
 * Parsed blocks by kind and source, per schema (audit F9). A body opened
 * again (a tab switched to, a reload after an outside change) skips the
 * parse, check and serialize of every block it still shares with an earlier
 * load. Least recently used entries go once the sources held pass the cap.
 */
const PARSE_CACHE_BYTES = 8 * 1024 * 1024
type ParseCache = { map: Map<string, JSONContent>; bytes: number }
const parseCaches = new WeakMap<Schema, ParseCache>()

function parseCacheOf(editor: Editor): ParseCache {
  let cache = parseCaches.get(editor.schema)
  if (!cache) {
    cache = { map: new Map(), bytes: 0 }
    parseCaches.set(editor.schema, cache)
  }
  return cache
}

function remember(cache: ParseCache, key: string, node: JSONContent, size: number): void {
  if (size > PARSE_CACHE_BYTES / 4) return
  cache.map.set(key, node)
  cache.bytes += size
  for (const [k] of cache.map) {
    if (cache.bytes <= PARSE_CACHE_BYTES) break
    cache.map.delete(k)
    cache.bytes -= k.length - 1 - k.indexOf('\0')
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

type ParsedBody = { content: JSONContent[]; leading: string; trailing: string }

/**
 * The nodes for `body`'s blocks, each stamped with its source, with the blank
 * lines before the first block and after the last. Used by `loadBody` and for
 * pasted Markdown (`extensions/blockSelection.ts`).
 */
export function parseBody(editor: Editor, body: string): ParsedBody {
  const blocks = splitBlocks(body)
  let leading = ''
  let trailing = ''
  if (blocks.length && blocks[0].kind === 'space') leading = blocks.shift()!.raw
  if (blocks.length && blocks[blocks.length - 1].kind === 'space') trailing = blocks.pop()!.raw
  const loaded = loadList(editor, buildTree(blocks))
  return { content: loaded.content, leading: leading + loaded.leading, trailing }
}

/** Replace the editor's document with `body`. The load is not undoable and fires no update. */
export function loadBody(editor: Editor, body: string): void {
  const { content, leading, trailing } = parseBody(editor, body)
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
  const final = /(?:\r\n|\n|\r)$/.exec(body)?.[0] ?? ''
  edges.set(editor, { leading, trailing, eol: body.includes('\r\n') ? '\r\n' : '\n', final })
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
    case 'blockRef':
      return blockRefMarkdown(String(a.target ?? ''), String(a.id ?? ''), a.label as string | null)
    case 'dataViewEmbed':
      return dataViewEmbedMarkdown(String(a.kind ?? 'collection'), String(a.id ?? ''), a.label as string | null)
    case 'buttonBlock':
      return buttonBlockMarkdown(String(a.label ?? ''))
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

/**
 * The options a leaf writes. When the block's node type changed in the editor
 * (Turn Into, a code fence typed at its start), known options that do not apply
 * to the new type are left out; unknown options always stay (rule 3).
 */
function leafOptions(editor: Editor, node: PMNode): Option[] {
  const options = (node.attrs.blockOptions as Option[] | null) ?? []
  if (node.type.name === 'rawBlock' || node.attrs.blockSource != null) return options
  if (options.every((o) => optionApplies(o.key, node))) return options
  const origin = node.attrs.blockOrigin as string | null | undefined
  if (origin != null) {
    const block = splitBlocks(origin).find((b) => b.kind !== 'space')
    // Still the node type it was loaded as: its options are as read.
    if (block && sourceToNode(editor, block, options).type === node.type.name) return options
  }
  return options.filter((o) => optionApplies(o.key, node))
}

/** The annotation line for a leaf: the original while its options are unchanged, else canonical. */
function leafAnnotation(editor: Editor, node: PMNode, eol: string): string {
  const options = leafOptions(editor, node)
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

  const annotation = leafAnnotation(editor, node, eol)
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
  const loaded = edges.get(editor)
  const { leading, trailing, eol, final } = loaded ?? { leading: '', trailing: '', eol: '\n', final: '' }
  const blocks: EditorBlock[] = []
  if (leading) blocks.push({ raw: leading, markdown: leading, kind: 'space' })
  const { doc } = editor.state
  doc.forEach((node, _offset, index) => {
    const entry = nodeEntry(editor, node, eol)
    if (entry) blocks.push(entry)
    // The blank lines after the last block are `trailing` (the load leaves the last node none);
    // a node that became last through a join or a move drops the ones it carried.
    const after = node.attrs.blockTrailing as string | null | undefined
    if (after && index < doc.childCount - 1) blocks.push({ raw: after, markdown: after, kind: 'space' })
  })
  if (trailing) blocks.push({ raw: trailing, markdown: trailing, kind: 'space' })
  const out = serializeWithPreservation(blocks, loaded ? eol : undefined)
  if (!loaded || out === '') return out
  // Keep the body's trailing-newline state when its last block was replaced or added.
  if (final && !endsWithBreak(out)) return out + final
  if (!final && endsWithBreak(out)) return out.replace(/(?:\r\n|\n|\r)$/, '')
  return out
}
