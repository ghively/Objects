/**
 * Text on the canvas: `TextBlockEditor`, a small Tiptap editor over a text block's Markdown
 * (the app's block editor extensions, wikilinks included, so unedited Markdown comes back
 * byte for byte), and `MarkdownView`, the read-only rendering shown while nobody edits.
 *
 * The editor commits exactly once: on blur or Escape it calls `onCommit(markdown)`, and so does
 * an unmount that comes first (the canvas renders only visible nodes, so a node being edited
 * that leaves the viewport is unmounted without either), so nothing typed is lost.
 */
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { WhiteboardTextAlign } from '@/api/whiteboardTypes'
import { editorExtensions, loadBody, serializeBody } from '@/editor/document'
import '@/editor/editor.css'

export interface TextBlockEditorProps {
  markdown: string
  align?: WhiteboardTextAlign
  onCommit(markdown: string): void
  /** Placeholder-free; `className` sizes the editor inside its node. */
  className?: string
}

export function TextBlockEditor({ markdown, align, onCommit, className }: TextBlockEditorProps) {
  const committed = useRef(false)
  const commitRef = useRef<() => void>(() => {})
  /** The Markdown as last typed: what an unmount commits once the editor itself is gone. */
  const latest = useRef(markdown)
  const mounted = useRef(false)

  const editor = useEditor({
    extensions: editorExtensions(),
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    autofocus: 'end',
    editorProps: {
      attributes: { class: 'object-editor whiteboard-text-editor', spellcheck: 'true' },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Escape') {
          commitRef.current()
          return true
        }
        return false
      },
    },
    onBlur: () => commitRef.current(),
    onUpdate: ({ editor: e }) => {
      latest.current = serializeBody(e)
    },
  })

  commitRef.current = () => {
    if (committed.current) return
    committed.current = true
    onCommit(editor && !editor.isDestroyed ? serializeBody(editor) : latest.current)
  }

  // Unmounted before a blur or Escape: commit what was typed. One microtask later, because
  // StrictMode's mount-unmount-mount rehearsal remounts synchronously and must not end the edit.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      queueMicrotask(() => {
        if (!mounted.current) commitRef.current()
      })
    }
  }, [])

  const loaded = useRef(false)
  useEffect(() => {
    if (!editor || editor.isDestroyed || loaded.current) return
    loaded.current = true
    loadBody(editor, markdown)
    editor.commands.focus('end')
    // Loaded once: later block changes come from this editor's own commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Keys typed into the text never reach the canvas shortcuts.
    e.stopPropagation()
    if (e.key === 'Escape') commitRef.current()
  }

  return (
    <div
      className={'nodrag nopan nowheel cursor-text ' + (className ?? '')}
      style={{ textAlign: align ?? undefined }}
      data-whiteboard-editing=""
      onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <EditorContent editor={editor} className="object-editor-root" />
    </div>
  )
}

// ---- read-only Markdown ----

const INLINE = /(\[\[[^\]\n]+\]\]|\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_|~~[^~\n]+~~)/g

/** The text a wikilink shows: its alias, else its target (without a heading or block anchor). */
export function wikilinkText(link: string): string {
  const inner = link.replace(/^\[\[/, '').replace(/\]\]$/, '')
  const bar = inner.indexOf('|')
  if (bar >= 0) return inner.slice(bar + 1).trim()
  return inner.replace(/[#^].*$/, '').trim() || inner.trim()
}

const WIKILINK_STYLE = { borderRadius: 4, padding: '0 0.2em', background: 'var(--bg-hover)' }

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of text.matchAll(INLINE)) {
    const tok = m[0]
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const key = `${keyBase}-${i++}`
    if (tok.startsWith('[[')) {
      out.push(
        <span key={key} className="wikilink" data-wikilink="" style={WIKILINK_STYLE}>
          {wikilinkText(tok)}
        </span>,
      )
    } else if (tok.startsWith('**') || tok.startsWith('__')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('~~')) out.push(<s key={key}>{tok.slice(2, -2)}</s>)
    else if (tok.startsWith('`')) out.push(<code key={key}>{tok.slice(1, -1)}</code>)
    else out.push(<em key={key}>{tok.slice(1, -1)}</em>)
    last = at + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/**
 * A light, safe rendering of a text block's Markdown (React elements, never HTML): headings,
 * list items, paragraphs and the common inline marks, with wikilinks as link chips.
 */
export function MarkdownView({ markdown, align, className }: { markdown: string; align?: WhiteboardTextAlign; className?: string }) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  lines.forEach((line, i) => {
    const key = `l${i}`
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    const item = /^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[( |x|X)\]\s+)?(.*)$/.exec(line)
    if (heading) {
      const size = ['1.5em', '1.3em', '1.15em', '1em'][heading[1].length - 1]
      blocks.push(
        <div key={key} className="font-semibold" style={{ fontSize: size }}>
          {inline(heading[2], key)}
        </div>,
      )
    } else if (item) {
      blocks.push(
        <div key={key} className="flex gap-1.5">
          <span aria-hidden="true">{item[1] !== undefined ? (item[1] === ' ' ? '☐' : '☑') : '•'}</span>
          <span className="min-w-0">{inline(item[2], key)}</span>
        </div>,
      )
    } else if (line.trim() === '') {
      if (i > 0 && i < lines.length - 1) blocks.push(<div key={key} className="h-[0.75em]" />)
    } else {
      blocks.push(<div key={key}>{inline(line, key)}</div>)
    }
  })
  return (
    <div className={'whiteboard-markdown break-words ' + (className ?? '')} style={{ textAlign: align ?? undefined }} data-whiteboard-text="">
      {blocks}
    </div>
  )
}
