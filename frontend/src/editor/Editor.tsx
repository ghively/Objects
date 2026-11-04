import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { registerFlusher } from '@/lib/flush'
import { useSettings } from '@/settings/useSettings'
import { editorExtensions, loadBody, serializeBody } from './document'
import { createFindControl, FindInPage } from './extensions/findInPage'
import { BlockHandles } from './handles/BlockHandles'
import { GroupBlocksKey } from './handles/groupKey'
import { setEditorObject } from './nodes/blockRef'
import { BlockSelectionBar } from './selectionBar/BlockSelectionBar'
import { TokensMenu } from './tokens/TokensMenu'
import { SlashMenu } from './slash/SlashMenu'
import { useAutosave, type BodyEditorHandle } from './useAutosave'
import './editor.css'
import './handles/handles.css'

/** The empty-body placeholder. */
export const EDITOR_PLACEHOLDER = 'Write your text or search for blocks...'

/** Shows the placeholder on an editable body that is one empty paragraph. */
const EmptyPlaceholder = Extension.create({
  name: 'emptyPlaceholder',
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('emptyPlaceholder'),
        props: {
          decorations: (state) => {
            const { doc } = state
            const first = doc.firstChild
            if (!editor.isEditable || doc.childCount !== 1 || !first || first.type.name !== 'paragraph' || first.content.size > 0) {
              return null
            }
            return DecorationSet.create(doc, [
              Decoration.node(0, first.nodeSize, { class: 'is-editor-empty', 'data-placeholder': EDITOR_PLACEHOLDER }),
            ])
          },
        },
      }),
    ]
  },
})

export type EditorProps = {
  path: string
  body: string
  version: string
  readOnly: boolean
  onSaved: (version: string) => void
  onConflict: (currentVersion: string) => void
  /** The object's id, when known (see `useAutosave`). */
  objectId?: string | null
  /** Optional control handle for external-change and conflict handling (Task 10). */
  controlRef?: Ref<BodyEditorHandle | null>
  /**
   * Draw the editor's own empty-body placeholder (default). The inline view (a daily note) draws
   * its own text instead; two at once would be laid over each other. Read when the editor opens.
   */
  ownPlaceholder?: boolean
}

/**
 * Formatted block editor for an object's body. Unedited blocks are saved
 * byte-for-byte; saves happen 1000 ms after the last change and on blur.
 */
export function Editor({
  path,
  body,
  version,
  readOnly,
  onSaved,
  onConflict,
  objectId,
  controlRef,
  ownPlaceholder = true,
}: EditorProps) {
  const autosaveRef = useRef<ReturnType<typeof useAutosave> | null>(null)
  const disableSpellcheck = useSettings((s) => s.settings.disableSpellcheck)
  const disableNumbered = useSettings((s) => s.settings.disableNumberedListTransformation)
  // The extensions are built once per editor: the numbered-list setting applies to editors opened after it changes.
  const [extensions] = useState(() => [
    ...editorExtensions({ numberedListInputRule: !disableNumbered }),
    FindInPage,
    GroupBlocksKey,
    ...(ownPlaceholder ? [EmptyPlaceholder] : []),
  ])

  const editor = useEditor({
    extensions,
    editable: !readOnly,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { class: 'object-editor', spellcheck: disableSpellcheck ? 'false' : 'true' } },
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
    objectId,
  })
  autosaveRef.current = autosave

  useEffect(() => {
    editor?.setEditable(!readOnly, false)
  }, [editor, readOnly])

  // A space switch flushes every open editor's pending save first (read-only ones resolve at once).
  const settleRef = useRef(autosave.settle)
  settleRef.current = autosave.settle
  useEffect(() => registerFlusher(() => settleRef.current()), [])

  // The object this editor shows, for the block references it copies (M8), and its pending-save
  // flush (a block move to another object saves this one first).
  useEffect(() => {
    if (!editor) return
    setEditorObject(editor, { path, flush: () => settleRef.current() })
    return () => setEditorObject(editor, null)
  }, [editor, path])

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
      find: editor ? createFindControl(editor) : undefined,
    }),
    [editor, autosave, path],
  )

  // Leaving an object (or unmounting) with a pending save: save it under its own path.
  useEffect(() => {
    return () => {
      void autosave.leave(path) // no-op when nothing changed since the last load/save
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
      {editor && !readOnly && <BlockHandles editor={editor} />}
      {editor && !readOnly && <SlashMenu editor={editor} />}
      {editor && !readOnly && <TokensMenu editor={editor} path={path} />}
      {editor && !readOnly && <BlockSelectionBar editor={editor} />}
    </>
  )
}
