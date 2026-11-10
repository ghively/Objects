/**
 * `inlineTag` (M31, catalog §10 "Inline tag"): a `#tag` typed in a paragraph renders as a
 * coloured chip in the text.
 *
 * The chip is a decoration over the plain text, never a node or a mark: the document keeps the
 * `#tag` characters as they were, so a body with tags saves back byte for byte and opening a
 * page writes nothing.
 *
 * What counts as a tag follows the importer's reading of inline tags (`importers/markdown.py`
 * `inline_tags`): a `#` at the start of the text or after a space, `(` or `,`, then characters
 * that are not spaces or punctuation (`-`, `_` and `/` stay in it). A tag made of digits (and
 * `-`, `_`, `/`) only is not one (a hash before only digits, such as a ticket number or `#2024-11`). Not read: code blocks, inline code, link
 * text (so a URL's `#anchor` is never a tag), and a wikilink's label. Paragraphs and headings
 * are read wherever they sit (lists, quotes, toggles, table cells).
 *
 * The chip takes the colour of the Tag object of that name (the link index's Tag objects,
 * matched case-insensitively), else the neutral gray. A click opens the Tag object like a
 * link (the peek; Ctrl/Cmd: a new tab; Shift: the side panel), or, with no Tag object, a
 * search for `#tag` in a new tab (our call: a click never creates a tag).
 */
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { ObjectSummary } from '@/api/types'
import { useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { themeColor } from '@/theme/palette'
import { buildDecorations, updateDecorations, type DecorationVisitor } from './incrementalDecorations'

export const INLINE_TAG_CLASS = 'inline-tag'

/** Stands for an inline node or text that is not read (code, a link, a wikilink). */
const OPAQUE = '￼'

/**
 * A tag: `#` at the start or after whitespace, `(` or `,`, then its name. The name's excluded
 * characters are the importer's (`_TAG_RE`) plus `OPAQUE`, so a tag ends where code or a link
 * begins.
 */
const TAG_RE = /(?:(?<=[\s(,])|^)#([^\s#!"$%&'()*+,.:;<=>?@[\]^`{|}~\\￼]+)/gu

export interface InlineTagMatch {
  /** Offsets in the text: the `#` and the end of the name. */
  from: number
  to: number
  name: string
}

/** The inline tags in `text`, in order. */
export function findInlineTags(text: string): InlineTagMatch[] {
  if (!text.includes('#')) return []
  const out: InlineTagMatch[] = []
  for (const m of text.matchAll(TAG_RE)) {
    let name = m[1]
    // A trailing `/` is not part of the name (the importer strips it too).
    const trimmed = name.replace(/\/+$/, '')
    if (!trimmed || /^[\d\-_/]+$/.test(trimmed)) continue
    name = trimmed
    const from = m.index ?? 0
    out.push({ from, to: from + 1 + name.length, name })
  }
  return out
}

// ---------------------------------------------------------------------------
// Tag colours and targets: the link index's Tag objects

const TAG_TYPE = 'tag'

interface TagInfo {
  path: string
  color: string | null
}

let cacheFor: ObjectSummary[] | null = null
let cache = new Map<string, TagInfo>()

/** The space's Tag objects by lower-cased name (templates left out). */
function tagMap(): Map<string, TagInfo> {
  const objects = useLinkIndex.getState().objects
  if (objects === cacheFor) return cache
  const next = new Map<string, TagInfo>()
  for (const o of objects) {
    if (o.type !== TAG_TYPE || o.template) continue
    const key = o.title.toLowerCase()
    if (!next.has(key)) next.set(key, { path: o.path, color: o.color ?? null })
  }
  cacheFor = objects
  cache = next
  return next
}

/** What the chips show: each tag's colour, so a repaint happens only when one changes. */
function tagSignature(): string {
  return [...tagMap()].map(([k, v]) => `${k}\u0000${v.color ?? ''}`).sort().join('\u0001')
}

function chipStyle(name: string): string {
  const c = themeColor(tagMap().get(name.toLowerCase())?.color ?? null)
  return `background-color: var(--tag-bg-${c}); color: var(--tag-text-${c})`
}

/** Open the tag called `name`: its Tag object as a link opens, else a search for it. */
export function openInlineTag(name: string, mods: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }): void {
  const info = tagMap().get(name.toLowerCase())
  if (!info) {
    useTabs.getState().open({ kind: 'search', q: `#${name}` }, { newTab: true })
    return
  }
  const target = { kind: 'object' as const, path: info.path }
  if (mods.ctrlKey || mods.metaKey) useTabs.getState().open(target, { newTab: true, via: 'link' })
  else if (mods.shiftKey && !mods.altKey) useTabs.getState().openInSidepanel(target)
  else usePeek.getState().peek(info.path)
}

// ---------------------------------------------------------------------------
// Decorations

const READ = new Set(['paragraph', 'heading'])
const UNREAD_MARKS = new Set(['code', 'link'])

/** A textblock's inline content as text, one character per document position. */
function blockText(node: PMNode): string {
  let text = ''
  node.forEach((child) => {
    if (child.isText) {
      const t = child.text ?? ''
      text += child.marks.some((m) => UNREAD_MARKS.has(m.type.name)) ? OPAQUE.repeat(t.length) : t
    } else if (child.type.name === 'hardBreak') {
      text += '\n'.repeat(child.nodeSize)
    } else {
      text += OPAQUE.repeat(child.nodeSize)
    }
  })
  return text
}

const visit: DecorationVisitor = (node, pos, decos) => {
  if (node.isTextblock) {
    if (!READ.has(node.type.name) || node.type.spec.code) return false
    for (const t of findInlineTags(blockText(node))) {
      decos.push(
        Decoration.inline(pos + 1 + t.from, pos + 1 + t.to, {
          class: INLINE_TAG_CLASS,
          'data-inline-tag': t.name,
          style: chipStyle(t.name),
        }),
      )
    }
    return false
  }
  return !node.isLeaf
}

export const inlineTagKey = new PluginKey<DecorationSet>('inlineTag')

/** The chips the editor shows now (tests). */
export function inlineTagDecorations(state: EditorState): DecorationSet {
  return inlineTagKey.getState(state) ?? DecorationSet.empty
}

// Views showing chips, repainted when a tag's colour or existence changes.
const views = new Set<EditorView>()
let signature = ''
let unsubscribe: (() => void) | null = null

function watchTags(view: EditorView): () => void {
  views.add(view)
  if (!unsubscribe) {
    signature = tagSignature()
    unsubscribe = useLinkIndex.subscribe((s, prev) => {
      if (s.objects === prev.objects) return
      const next = tagSignature()
      if (next === signature) return
      signature = next
      for (const v of views) if (!v.isDestroyed) v.dispatch(v.state.tr.setMeta(inlineTagKey, 'repaint'))
    })
  }
  return () => {
    views.delete(view)
    if (views.size === 0 && unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  }
}

export const InlineTag = Extension.create({
  name: 'inlineTag',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: inlineTagKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc, visit),
          apply: (tr, old) => (tr.getMeta(inlineTagKey) === 'repaint' ? buildDecorations(tr.doc, visit) : updateDecorations(old, tr, visit)),
        },
        view: (view) => ({ destroy: watchTags(view) }),
        props: {
          decorations: (state) => inlineTagKey.getState(state),
          handleClick: (_view, _pos, event) => {
            const el = event.target instanceof Element ? event.target.closest(`.${INLINE_TAG_CLASS}[data-inline-tag]`) : null
            const name = el?.getAttribute('data-inline-tag')
            if (!name || event.button !== 0) return false
            event.preventDefault()
            openInlineTag(name, event)
            return true
          },
        },
      }),
    ]
  },
})
