import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { useAutosave } from './useAutosave'

export type RawModeProps = {
  path: string
  /** The object's body text, edited verbatim (line endings included). */
  text: string
  version: string
  onSaved: (version: string) => void
  onConflict?: (currentVersion: string) => void
  readOnly?: boolean
}

const rawTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: 'var(--text)', fontSize: '13.5px' },
    '.cm-content': { fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace", caretColor: 'var(--text)' },
    '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--text-muted)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'var(--bg-hover)' },
    '&.cm-focused': { outline: 'none' },
  },
  { dark: true },
)

/**
 * Raw Markdown mode: CodeMirror 6 over the body text, saved through the same
 * debounced, conflict-safe `saveBody` as the formatted editor.
 */
export function RawMode({ path, text, version, onSaved, onConflict, readOnly = false }: RawModeProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const loadedRef = useRef<{ path: string; text: string } | null>(null)

  const autosave = useAutosave({
    path,
    version,
    readOnly,
    // sliceDoc() joins lines with the state's lineSeparator (the text's own EOL).
    getBody: () => (viewRef.current ? viewRef.current.state.sliceDoc() : null),
    onSaved,
    onConflict,
  })
  const autosaveRef = useRef(autosave)
  autosaveRef.current = autosave

  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({ doc: '', extensions: [] }),
    })
    viewRef.current = view
    return () => {
      void autosaveRef.current.flush()
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const loaded = loadedRef.current
    if (loaded?.path === path && (loaded.text === text || autosave.savedBody() === text)) return
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    view.setState(
      EditorState.create({
        doc: text,
        extensions: [
          EditorState.lineSeparator.of(eol),
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown(),
          EditorView.lineWrapping,
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          rawTheme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) autosaveRef.current.schedule()
            if (u.focusChanged && !u.view.hasFocus) void autosaveRef.current.flush()
          }),
        ],
      }),
    )
    autosave.markLoaded(text, version)
    loadedRef.current = { path, text }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, text, readOnly])

  return <div ref={hostRef} className="raw-mode h-full" data-path={path} />
}
