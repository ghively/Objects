/**
 * The Markdown preview of a `markdown` code block: a read-only editor built
 * from the same extensions and loader as the page editor, so it renders the
 * text exactly as a page body would. Raw HTML stays a raw block (shown as its
 * source text); nothing is injected into the page.
 */
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect } from 'react'
import { editorExtensions, loadBody } from '../document'

export function MarkdownPreview({ text }: { text: string }) {
  const editor = useEditor({
    extensions: editorExtensions(),
    editable: false,
    immediatelyRender: true,
    editorProps: { attributes: { class: 'object-editor markdown-preview-prose', 'aria-readonly': 'true' } },
  })

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    loadBody(editor, text)
  }, [editor, text])

  return (
    <div className="markdown-preview" data-testid="markdown-preview">
      <EditorContent editor={editor} />
    </div>
  )
}
