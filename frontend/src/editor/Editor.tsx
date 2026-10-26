import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { editorExtensions, loadBody, serializeBody } from './document'
import { useAutosave, type BodyEditorHandle } from './useAutosave'
import './editor.css'

export type EditorProps = {
  path: string
  body: string
  version: string
  readOnly: boolean
  onSaved: (version: string) => void
  onConflict: (currentVersion: string) => void
  /** Optional control handle for external-change and conflict handling (Task 10). */
  controlRef?: Ref<BodyEditorHandle | null>
}

/**
 * Formatted block editor for an object's body. Unedited blocks are saved
 * byte-for-byte; saves happen 1000 ms after the last change and on blur.
 */
export function Editor({ path, body, version, readOnly, onSaved, onConflict, controlRef }: EditorProps) {
  const autosaveRef = useRef<ReturnType<typeof useAutosave> | null>(null)

  const editor = useEditor({
    extensions: editorExtensions(),
    editable: !readOnly,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { class: 'object-editor', spellcheck: 'true' } },
    onUpdate: ({ transaction }) => {
      if (transaction.docChanged) autosaveRef.current?.schedule()
    },
    onBlur: () => {
      void autosaveRef.current?.flush()
    },
  })

  const autosave = useAutosave({
    path,
    version,
    readOnly,
    getBody: () => (editor && !editor.isDestroyed ? serializeBody(editor) : null),
    onSaved,
    onConflict,
  })
  autosaveRef.current = autosave

  useEffect(() => {
    editor?.setEditable(!readOnly, false)
  }, [editor, readOnly])

  // Load the body when the object or its on-disk text changes. A body equal to
  // what this editor just saved is our own write echoing back: keep the doc.
  const loadedRef = useRef<{ path: string; body: string } | null>(null)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const loaded = loadedRef.current
    const sameObject = loaded?.path === path
    if (sameObject && (loaded.body === body || autosave.savedBody() === body)) return
    loadBody(editor, body)
    autosave.markLoaded(body, version)
    loadedRef.current = { path, body }
    // `version` is read at load time only; later versions come from our own saves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, path, body])

  useImperativeHandle(
    controlRef,
    () => ({
      getBody: () => (editor && !editor.isDestroyed ? serializeBody(editor) : null),
      savedBody: () => autosave.savedBody(),
      isDirty: () => autosave.isDirty(),
      flush: () => autosave.settle(),
      hold: () => autosave.hold(),
      resume: (v: string, saveNow?: boolean) => autosave.resume(v, saveNow),
      reload: (text: string, v: string) => {
        if (!editor || editor.isDestroyed) return
        loadBody(editor, text)
        autosave.markLoaded(text, v)
        loadedRef.current = { path, body: text }
      },
    }),
    [editor, autosave, path],
  )

  // Leaving an object (or unmounting) with a pending save: save it under its own path.
  useEffect(() => {
    return () => {
      void autosave.flush(path) // no-op when nothing changed since the last load/save
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  return (
    <>
      {autosave.saveError && (
        <div role="status" className="autosave-error">
          {autosave.saveError}
        </div>
      )}
      <EditorContent editor={editor} className="object-editor-root" data-readonly={readOnly || undefined} />
    </>
  )
}
