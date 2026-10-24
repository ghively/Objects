import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState, Transaction } from '@codemirror/state'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { placeholderFor } from '../format'
import type { CellProps } from './types'

const SAVE_DEBOUNCE_MS = 600

const blocksTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: 'var(--text)', fontSize: '15px' },
    '.cm-content': { fontFamily: 'inherit', caretColor: 'var(--text)', padding: '0' },
    '.cm-line': { padding: '0' },
    '.cm-placeholder': { color: 'var(--text-muted)' },
    '&.cm-focused': { outline: 'none' },
  },
  { dark: true },
)

/**
 * An extra content property (`blocks`): Markdown in CodeMirror (Tiptap comes in M7). Saves
 * 600 ms after typing stops and on blur; an empty text saves `null`. While it has focus, a new
 * value from outside doesn't replace what the user is typing.
 */
export function BlocksCell({ def, value, readOnly, onChange }: CellProps<string | null>) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const lastRef = useRef<string | null>(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const initial = useRef({ value, placeholder: placeholderFor(def) })

  const flushRef = useRef(() => {})
  flushRef.current = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const view = viewRef.current
    if (!view) return
    const text = view.state.doc.toString()
    const next = text.trim() === '' ? null : text
    if (next === (lastRef.current || null)) return
    lastRef.current = next
    onChangeRef.current(next)
  }

  useEffect(() => {
    if (!hostRef.current) return
    const editable = !readOnly
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: lastRef.current ?? initial.current.value ?? '',
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown(),
          EditorView.lineWrapping,
          EditorState.readOnly.of(!editable),
          EditorView.editable.of(editable),
          cmPlaceholder(initial.current.placeholder),
          blocksTheme,
          EditorView.updateListener.of((u) => {
            // Only the user's edits schedule a save, not a value set from outside.
            const byUser = u.transactions.some((t) => t.annotation(Transaction.userEvent) !== undefined)
            if (!u.docChanged || !editable || !byUser) return
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => flushRef.current(), SAVE_DEBOUNCE_MS)
          }),
          EditorView.domEventHandlers({
            blur: () => {
              if (editable) flushRef.current()
            },
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => {
      if (editable) flushRef.current()
      view.destroy()
      viewRef.current = null
    }
  }, [readOnly])

  useEffect(() => {
    const view = viewRef.current
    lastRef.current = value
    if (!view || view.hasFocus) return
    const text = value ?? ''
    if (view.state.doc.toString() !== text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
    }
  }, [value])

  return <div ref={hostRef} aria-label={def.name} className="min-h-[1.5em]" />
}
