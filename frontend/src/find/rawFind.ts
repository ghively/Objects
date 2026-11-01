/**
 * Find in page for raw mode: the same `FindControl` the find bar drives on the formatted editor,
 * over a CodeMirror 6 view. Matches come from `findMatches` over the document text (CodeMirror
 * positions count a line break as one character, as `doc.toString()` does, whatever the file's
 * EOL), so "Match case" and "Match whole word" behave exactly as in the formatted editor. Every
 * match is a mark decoration `find-match`, the current one also `find-match-current`. Replace
 * edits only the matched ranges (one transaction for "Replace all", so one autosave); every edit
 * goes through the view, so raw mode's own autosave saves it.
 */
import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import type { FindControl, FindStatus } from '@/editor/extensions/findInPage'
import { RAW_CONTROLS } from './findControl'
import { findMatches, NO_FIND_OPTIONS, type FindOptions, type TextMatch } from './findText'

export { isRawFindControl } from './findControl'

const MATCH_CLASS = 'find-match'
const CURRENT_CLASS = 'find-match-current'

export interface RawFindState extends FindOptions {
  query: string
  /** The current match, or -1 when there is none. */
  index: number
  matches: TextMatch[]
  decorations: DecorationSet
}

const EMPTY: RawFindState = { query: '', ...NO_FIND_OPTIONS, index: -1, matches: [], decorations: Decoration.none }

const setFind = StateEffect.define<{ query: string } & FindOptions>()
const moveFind = StateEffect.define<1 | -1>()

const matchMark = Decoration.mark({ class: MATCH_CLASS })
const currentMark = Decoration.mark({ class: `${MATCH_CLASS} ${CURRENT_CLASS}` })

function decorate(matches: TextMatch[], index: number): DecorationSet {
  if (matches.length === 0) return Decoration.none
  const b = new RangeSetBuilder<Decoration>()
  matches.forEach((m, i) => b.add(m.from, m.to, i === index ? currentMark : matchMark))
  return b.finish()
}

export const rawFindField = StateField.define<RawFindState>({
  create: () => EMPTY,
  update(prev, tr) {
    let next = prev
    for (const e of tr.effects) {
      if (e.is(setFind)) {
        const opts = { matchCase: e.value.matchCase, wholeWord: e.value.wholeWord }
        const matches = findMatches(tr.state.doc.toString(), e.value.query, opts)
        const index = matches.length ? 0 : -1
        next = { query: e.value.query, ...opts, index, matches, decorations: decorate(matches, index) }
      } else if (e.is(moveFind)) {
        const n = next.matches.length
        if (n === 0) continue
        const index = (((next.index + e.value) % n) + n) % n
        next = { ...next, index, decorations: decorate(next.matches, index) }
      }
    }
    if (next === prev && tr.docChanged && prev.query) {
      const matches = findMatches(tr.state.doc.toString(), prev.query, prev)
      const n = matches.length
      // The match after a replaced one takes its index; past the end wraps to the first.
      const index = n === 0 ? -1 : prev.index < 0 || prev.index >= n ? 0 : prev.index
      next = { ...prev, index, matches, decorations: decorate(matches, index) }
    }
    return next
  },
  provide: (f) => EditorView.decorations.from(f, (s) => s.decorations),
})

export function getRawFindState(state: EditorState): RawFindState {
  return state.field(rawFindField, false) ?? EMPTY
}


export interface RawFind {
  /** Add to the view's state (again after every `setState`, then call `reapply`). */
  extension: Extension
  /** What `BodyEditorHandle.find` returns in raw mode. */
  control: FindControl
  /** After a fresh state (a reload), apply the last query again and tell the bar. */
  reapply(): void
}

/** A find control over the view `getView` returns (null while there is none). */
export function createRawFind(getView: () => EditorView | null): RawFind {
  const listeners = new Set<() => void>()
  let last: { query: string } & FindOptions = { query: '', ...NO_FIND_OPTIONS }
  const notify = () => {
    for (const l of [...listeners]) l()
  }

  const status = (): FindStatus => {
    const view = getView()
    if (!view) return { index: -1, count: 0 }
    const s = getRawFindState(view.state)
    return { index: s.index, count: s.matches.length }
  }

  /** Scroll the current match into view (and, when stepping, select it). */
  const reveal = (view: EditorView, select: boolean) => {
    const s = getRawFindState(view.state)
    const m = s.matches[s.index]
    if (!m) return
    view.dispatch({
      effects: EditorView.scrollIntoView(m.from, { y: 'nearest' }),
      ...(select ? { selection: { anchor: m.from, head: m.to } } : {}),
    })
  }

  const move = (delta: 1 | -1): number => {
    const view = getView()
    if (!view || getRawFindState(view.state).matches.length === 0) return -1
    view.dispatch({ effects: moveFind.of(delta) })
    reveal(view, true)
    return status().index
  }

  const editable = (view: EditorView) => !view.state.readOnly

  const control: FindControl = {
    set(query, opts) {
      const view = getView()
      const prev = view ? getRawFindState(view.state) : last
      last = { query, matchCase: opts?.matchCase ?? prev.matchCase, wholeWord: opts?.wholeWord ?? prev.wholeWord }
      if (!view) return 0
      view.dispatch({ effects: setFind.of(last) })
      reveal(view, false)
      return status().count
    },
    next: () => move(1),
    previous: () => move(-1),
    replace(text) {
      const view = getView()
      if (!view || !editable(view)) return
      const s = getRawFindState(view.state)
      const m = s.matches[s.index]
      if (!m) return
      view.dispatch({ changes: { from: m.from, to: m.to, insert: text }, userEvent: 'input.replace' })
      reveal(view, false)
    },
    replaceAll(text) {
      const view = getView()
      if (!view || !editable(view)) return 0
      const matches = getRawFindState(view.state).matches
      if (matches.length === 0) return 0
      // One transaction: CodeMirror maps every range against the original document.
      view.dispatch({
        changes: matches.map((m) => ({ from: m.from, to: m.to, insert: text })),
        userEvent: 'input.replace.all',
      })
      return matches.length
    },
    clear() {
      last = { ...last, query: '' }
      const view = getView()
      if (view && getRawFindState(view.state).query) view.dispatch({ effects: setFind.of(last) })
    },
    status,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }

  RAW_CONTROLS.add(control)

  const extension: Extension = [
    rawFindField,
    EditorView.updateListener.of((u) => {
      if (u.transactions.length > 0) notify()
    }),
  ]

  return {
    extension,
    control,
    reapply() {
      const view = getView()
      if (view && last.query) view.dispatch({ effects: setFind.of(last) })
      notify()
    },
  }
}
