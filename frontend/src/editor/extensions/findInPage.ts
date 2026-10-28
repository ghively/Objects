/**
 * `findInPage`: Find in page for the body editor.
 *
 * Plugin state `{query, matchCase, wholeWord, index}` plus the matches it implies. Matches are
 * found per textblock over its inline content: text nodes by their text, wikilink atoms by the
 * label they show (so "Ada" finds `[[Ada Lovelace]]`). Every match is decorated `find-match`, the
 * current one also `find-match-current`. Replacing only ever edits text: a match that touches an
 * atom is skipped, so a wikilink is never split. `replaceAll` is one transaction, so one autosave.
 */
import { Extension, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { findRegExp, NO_FIND_OPTIONS, type FindOptions } from '@/find/findText'

export type { FindOptions } from '@/find/findText'

/** A match in document positions. `atom` is set when it covers (part of) a non-text node. */
export interface DocMatch {
  from: number
  to: number
  atom: boolean
}

export interface FindPluginState extends FindOptions {
  query: string
  /** The current match, or -1 when there is none. */
  index: number
  matches: DocMatch[]
  decorations: DecorationSet
  /** Bumped when the current match should be scrolled into view. */
  scroll: number
}

type FindMeta =
  | { type: 'set'; query: string; matchCase: boolean; wholeWord: boolean }
  | { type: 'move'; delta: 1 | -1 }

export const findInPageKey = new PluginKey<FindPluginState>('findInPage')

export const FIND_MATCH_CLASS = 'find-match'
export const FIND_MATCH_CURRENT_CLASS = 'find-match-current'

/** One run of a textblock's inline content, in the searchable text and in the document. */
interface Segment {
  /** Offset of this run in the textblock's searchable text. */
  start: number
  length: number
  /** Document position of the node. */
  pos: number
  atom: boolean
  nodeSize: number
}

function inlineLabel(node: PMNode): string {
  if (node.type.name === 'wikilink') return String(node.attrs.label || node.attrs.target || '')
  if (node.type.name === 'hardBreak') return '\n'
  return '￼'
}

/** Every match of the query in `doc`, in document order. */
export function findDocMatches(doc: PMNode, query: string, opts: FindOptions = NO_FIND_OPTIONS): DocMatch[] {
  const re = findRegExp(query, opts)
  if (!re) return []
  const out: DocMatch[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    const segs: Segment[] = []
    node.forEach((child, offset) => {
      const p = pos + 1 + offset
      const label = child.isText ? (child.text ?? '') : inlineLabel(child)
      if (!label) return
      segs.push({ start: text.length, length: label.length, pos: p, atom: !child.isText, nodeSize: child.nodeSize })
      text += label
    })
    if (!text) return false
    let si = 0
    re.lastIndex = 0
    for (const m of text.matchAll(re)) {
      if (m[0].length === 0) continue
      const a = m.index
      const b = a + m[0].length
      while (si < segs.length - 1 && segs[si].start + segs[si].length <= a) si++
      let sj = si
      let atom = segs[si].atom
      while (sj < segs.length - 1 && segs[sj].start + segs[sj].length < b) {
        sj++
        atom ||= segs[sj].atom
      }
      const first = segs[si]
      const last = segs[sj]
      const from = first.atom ? first.pos : first.pos + (a - first.start)
      const to = last.atom ? last.pos + last.nodeSize : last.pos + (b - last.start)
      out.push({ from, to, atom })
    }
    return false
  })
  return out
}

function decorate(doc: PMNode, matches: DocMatch[], index: number): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty
  return DecorationSet.create(
    doc,
    matches.map((m, i) =>
      Decoration.inline(m.from, m.to, {
        class: i === index ? `${FIND_MATCH_CLASS} ${FIND_MATCH_CURRENT_CLASS}` : FIND_MATCH_CLASS,
      }),
    ),
  )
}

const EMPTY: FindPluginState = {
  query: '',
  matchCase: false,
  wholeWord: false,
  index: -1,
  matches: [],
  decorations: DecorationSet.empty,
  scroll: 0,
}

export function getFindState(state: EditorState): FindPluginState {
  return findInPageKey.getState(state) ?? EMPTY
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findInPage: {
      /** Set the query and options; the first match becomes current. An empty query clears. */
      setFind: (query: string, opts?: Partial<FindOptions>) => ReturnType
      /** Move to the next match (wrapping) and scroll it into view. */
      findNext: () => ReturnType
      /** Move to the previous match (wrapping) and scroll it into view. */
      findPrevious: () => ReturnType
      /** Replace the current match with `text`; refused for a match that touches an atom. */
      replaceCurrent: (text: string) => ReturnType
      /** Replace every text-only match with `text`, in one transaction. */
      replaceAll: (text: string) => ReturnType
      /** Clear the query and every decoration. */
      clearFind: () => ReturnType
    }
  }
}

export const FindInPage = Extension.create({
  name: 'findInPage',

  addCommands() {
    return {
      setFind:
        (query, opts) =>
        ({ tr, state, dispatch }) => {
          const prev = getFindState(state)
          const meta: FindMeta = {
            type: 'set',
            query,
            matchCase: opts?.matchCase ?? prev.matchCase,
            wholeWord: opts?.wholeWord ?? prev.wholeWord,
          }
          if (dispatch) tr.setMeta(findInPageKey, meta).setMeta('addToHistory', false)
          return true
        },
      findNext:
        () =>
        ({ tr, state, dispatch }) => {
          if (getFindState(state).matches.length === 0) return false
          if (dispatch) tr.setMeta(findInPageKey, { type: 'move', delta: 1 } satisfies FindMeta)
          return true
        },
      findPrevious:
        () =>
        ({ tr, state, dispatch }) => {
          if (getFindState(state).matches.length === 0) return false
          if (dispatch) tr.setMeta(findInPageKey, { type: 'move', delta: -1 } satisfies FindMeta)
          return true
        },
      replaceCurrent:
        (text) =>
        ({ tr, state, dispatch, editor }) => {
          if (!editor.isEditable) return false
          const s = getFindState(state)
          const m = s.matches[s.index]
          if (!m || m.atom) return false
          if (dispatch) {
            if (text) tr.insertText(text, m.from, m.to)
            else tr.delete(m.from, m.to)
          }
          return true
        },
      replaceAll:
        (text) =>
        ({ tr, state, dispatch, editor }) => {
          if (!editor.isEditable) return false
          const targets = getFindState(state).matches.filter((m) => !m.atom)
          if (targets.length === 0) return false
          if (dispatch) {
            // Back to front, so earlier positions stay valid.
            for (let i = targets.length - 1; i >= 0; i--) {
              const m = targets[i]
              if (text) tr.insertText(text, m.from, m.to)
              else tr.delete(m.from, m.to)
            }
          }
          return true
        },
      clearFind:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch)
            tr.setMeta(findInPageKey, { type: 'set', query: '', matchCase: false, wholeWord: false } satisfies FindMeta)
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FindPluginState>({
        key: findInPageKey,
        state: {
          init: () => EMPTY,
          apply(tr, prev) {
            const meta = tr.getMeta(findInPageKey) as FindMeta | undefined
            if (meta?.type === 'set') {
              const opts = { matchCase: meta.matchCase, wholeWord: meta.wholeWord }
              const matches = findDocMatches(tr.doc, meta.query, opts)
              const index = matches.length ? 0 : -1
              return {
                query: meta.query,
                ...opts,
                index,
                matches,
                decorations: decorate(tr.doc, matches, index),
                scroll: prev.scroll + (matches.length ? 1 : 0),
              }
            }
            if (meta?.type === 'move') {
              const n = prev.matches.length
              if (n === 0) return prev
              const index = (((prev.index + meta.delta) % n) + n) % n
              return { ...prev, index, decorations: decorate(tr.doc, prev.matches, index), scroll: prev.scroll + 1 }
            }
            if (tr.docChanged && prev.query) {
              const matches = findDocMatches(tr.doc, prev.query, prev)
              const n = matches.length
              // The match after a replaced one takes its index; past the end wraps to the first.
              const index = n === 0 ? -1 : prev.index < 0 || prev.index >= n ? 0 : prev.index
              return { ...prev, index, matches, decorations: decorate(tr.doc, matches, index) }
            }
            return prev
          },
        },
        props: {
          decorations: (state) => getFindState(state).decorations,
        },
        view: () => ({
          update(view, prevState) {
            const s = getFindState(view.state)
            if (s.scroll === getFindState(prevState).scroll) return
            const el = view.dom.querySelector(`.${FIND_MATCH_CURRENT_CLASS}`) as HTMLElement | null
            if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
          },
        }),
      }),
    ]
  },
})

/** The editor's find state as the find bar shows it. */
export interface FindStatus {
  /** The current match (0-based), or -1. */
  index: number
  count: number
}

/** What the find bar drives on the formatted editor (`BodyEditorHandle.find`). */
export interface FindControl {
  /** Set the query and options; returns the number of matches. */
  set(query: string, opts?: Partial<FindOptions>): number
  /** Go to the next match (wrapping); returns its index, or -1. */
  next(): number
  /** Go to the previous match (wrapping); returns its index, or -1. */
  previous(): number
  /** Replace the current match (never inside a wikilink). */
  replace(text: string): void
  /** Replace every text-only match in one edit; returns how many were replaced. */
  replaceAll(text: string): number
  /** Clear the query and the decorations. */
  clear(): void
  /** The current index and match count. */
  status(): FindStatus
  /** Called after every editor transaction (edits change the matches); returns an unsubscribe. */
  subscribe(listener: () => void): () => void
}

function statusOf(editor: Editor): FindStatus {
  if (editor.isDestroyed) return { index: -1, count: 0 }
  const s = getFindState(editor.state)
  return { index: s.index, count: s.matches.length }
}

export function createFindControl(editor: Editor): FindControl {
  const alive = () => !editor.isDestroyed
  return {
    set(query, opts) {
      if (alive()) editor.commands.setFind(query, opts)
      return statusOf(editor).count
    },
    next() {
      if (alive()) editor.commands.findNext()
      return statusOf(editor).index
    },
    previous() {
      if (alive()) editor.commands.findPrevious()
      return statusOf(editor).index
    },
    replace(text) {
      if (alive()) editor.commands.replaceCurrent(text)
    },
    replaceAll(text) {
      if (!alive()) return 0
      const n = getFindState(editor.state).matches.filter((m) => !m.atom).length
      return editor.isEditable && editor.commands.replaceAll(text) ? n : 0
    },
    clear() {
      if (alive()) editor.commands.clearFind()
    },
    status: () => statusOf(editor),
    subscribe(listener) {
      editor.on('transaction', listener)
      return () => {
        editor.off('transaction', listener)
      }
    },
  }
}
