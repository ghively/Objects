/**
 * `StringEditor`: the block editor over a string value rather than an object's body. The
 * `blocks` (Content) and `textBlock` (Text) property cells use it (M9). It loads the value once
 * with the body's extensions, so unedited Markdown comes back byte for byte, and reports the
 * serialized Markdown 600 ms after typing stops and on blur (or unmount). A load or a blur with
 * no edit reports nothing.
 *
 * The value is a YAML string, whose `|-` style drops the final newline, so one trailing newline
 * is stripped before reporting.
 */
import { Extension, type Editor as TiptapEditor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { editorExtensions, loadBody, serializeBody } from './document'
import { BlockHandles } from './handles/BlockHandles'
import { setEditorObject } from './nodes/blockRef'
import { SlashMenu } from './slash/SlashMenu'
import { TokensMenu } from './tokens/TokensMenu'
import './editor.css'
import './handles/handles.css'

export const STRING_SAVE_DEBOUNCE_MS = 600

export interface StringEditorProps {
  /** The Markdown to edit; read at mount, and again when it changes while the editor is not focused. */
  value: string
  /** The edited Markdown (one trailing newline stripped); never called without an edit. */
  onChange(next: string): void
  /** The object that owns the value, for the token menu and block references; optional. */
  path?: string
  /** One paragraph only: Enter (Shift+Enter too) saves and calls `onEnter` instead of splitting; no slash menu or handles. */
  singleParagraph?: boolean
  onEnter?(): void
  /** Escape saves, then calls this; the cell decides what it means. */
  onEscape?(): void
  onBlur?(event: FocusEvent): void
  readOnly?: boolean
  autofocus?: boolean
  placeholder?: string
  ariaLabel?: string
  /** Gives the cell the Tiptap editor (for focus checks); called with null on unmount. */
  editorRef?(editor: TiptapEditor | null): void
}

/** `s` without one trailing line break. */
export function stripFinalNewline(s: string): string {
  return s.replace(/\r?\n$/, '')
}

function placeholderExtension(text: () => string | undefined) {
  return Extension.create({
    name: 'stringEditorPlaceholder',
    addProseMirrorPlugins() {
      const editor = this.editor
      return [
        new Plugin({
          key: new PluginKey('stringEditorPlaceholder'),
          props: {
            decorations: (state) => {
              const label = text()
              const first = state.doc.firstChild
              if (!label || !editor.isEditable || state.doc.childCount !== 1 || !first) return null
              if (first.type.name !== 'paragraph' || first.content.size > 0) return null
              return DecorationSet.create(state.doc, [
                Decoration.node(0, first.nodeSize, { class: 'is-editor-empty', 'data-placeholder': label }),
              ])
            },
          },
        }),
      ]
    },
  })
}

export function StringEditor({
  value,
  onChange,
  path,
  singleParagraph = false,
  onEnter,
  onEscape,
  onBlur,
  readOnly = false,
  autofocus = false,
  placeholder,
  ariaLabel,
  editorRef,
}: StringEditorProps) {
  const latest = useRef({ onChange, onEnter, onEscape, onBlur, placeholder, singleParagraph })
  latest.current = { onChange, onEnter, onEscape, onBlur, placeholder, singleParagraph }
  // The value last loaded or reported: an unedited flush compares equal and reports nothing.
  const lastRef = useRef(value)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [extensions] = useState(() => [...editorExtensions(), placeholderExtension(() => latest.current.placeholder)])

  const editor = useEditor({
    extensions,
    editable: !readOnly,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    autofocus: autofocus ? 'end' : false,
    editorProps: {
      attributes: {
        class: 'object-editor string-editor',
        spellcheck: 'true',
        role: 'textbox',
        ...(singleParagraph ? {} : { 'aria-multiline': 'true' }),
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Escape' && latest.current.onEscape) {
          flushRef.current()
          latest.current.onEscape()
          return true
        }
        if (event.key === 'Enter' && latest.current.singleParagraph) {
          // A paragraph has no line breaks: Enter saves and hands over instead.
          flushRef.current()
          latest.current.onEnter?.()
          return true
        }
        return false
      },
    },
    onUpdate: ({ transaction }) => {
      if (!transaction.docChanged) return
      dirty.current = true
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => flushRef.current(), STRING_SAVE_DEBOUNCE_MS)
    },
    onBlur: ({ event }) => {
      flushRef.current()
      latest.current.onBlur?.(event)
    },
  })

  const flushRef = useRef(() => {})
  flushRef.current = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (!dirty.current || !editor || editor.isDestroyed) return
    dirty.current = false
    const next = stripFinalNewline(serializeBody(editor))
    if (next === stripFinalNewline(lastRef.current)) return
    lastRef.current = next
    latest.current.onChange(next)
  }

  // Loaded once; afterwards a value from outside replaces the text only while the user isn't in it.
  const loaded = useRef(false)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (!loaded.current) {
      loaded.current = true
      loadBody(editor, value)
      lastRef.current = value
      if (autofocus) editor.commands.focus('end')
      return
    }
    if (value === lastRef.current || editor.view.hasFocus() || dirty.current) return
    loadBody(editor, value)
    lastRef.current = value
  }, [editor, value, autofocus])

  useEffect(() => {
    editor?.setEditable(!readOnly, false)
  }, [editor, readOnly])

  useEffect(() => {
    if (!editor || !path) return
    setEditorObject(editor, { path })
    return () => setEditorObject(editor, null)
  }, [editor, path])

  const refCb = useRef(editorRef)
  refCb.current = editorRef
  useEffect(() => {
    refCb.current?.(editor)
    return () => refCb.current?.(null)
  }, [editor])

  // Leaving with a pending edit saves it.
  useEffect(() => () => flushRef.current(), [])

  return (
    <>
      <EditorContent editor={editor} className="object-editor-root string-editor-root" data-readonly={readOnly || undefined} />
      {editor && !readOnly && !singleParagraph && <BlockHandles editor={editor} />}
      {editor && !readOnly && !singleParagraph && <SlashMenu editor={editor} />}
      {editor && !readOnly && <TokensMenu editor={editor} path={path ?? ''} />}
    </>
  )
}
