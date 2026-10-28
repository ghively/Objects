/**
 * Pasting or dropping files into the editor: each file is uploaded into
 * `Attachments/` (`media/upload.ts`, which refuses anything over 100 MiB
 * before sending) and its media block is inserted at the drop point, or below
 * the block at the cursor for a paste. While a file uploads a toast says
 * "Insert image" (`pasteInput.image_from_file`) or "Insert file"
 * (`pasteInput.file`).
 *
 * The drop point is mapped through every transaction until the uploads are
 * done, so typing elsewhere meanwhile doesn't move where the blocks land.
 */
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state'
import { attachmentKind } from '../annotations'
import { showToast, uploadFile } from '../media/upload'

export const fileDropKey = new PluginKey('fileDrop')

/** `pasteInput.image_from_file` / `pasteInput.file`, verbatim. */
export function uploadToastFor(name: string): string {
  return attachmentKind(name) === 'image' ? 'Insert image' : 'Insert file'
}

/** Upload `files` one by one and insert each block at `at` (mapped through later edits), or at the cursor. */
export async function insertFiles(editor: Editor, files: File[], at: number | null): Promise<void> {
  let pos = at
  const follow = ({ transaction }: { transaction: { mapping: { map(p: number): number } } }) => {
    if (pos != null) pos = transaction.mapping.map(pos)
  }
  editor.on('transaction', follow)
  try {
    for (const file of files) {
      showToast(uploadToastFor(file.name))
      const attrs = await uploadFile(file)
      if (!attrs || editor.isDestroyed) continue
      editor
        .chain()
        .command(({ tr }) => {
          if (pos != null) {
            const p = Math.max(0, Math.min(pos, tr.doc.content.size))
            tr.setSelection(Selection.near(tr.doc.resolve(p)))
          }
          return true
        })
        .insertMedia(attrs)
        .run()
      // The next file goes below the one just inserted (the selection is on it).
      pos = null
    }
  } finally {
    editor.off('transaction', follow)
  }
}

function filesOf(list: FileList | null | undefined): File[] {
  return list ? Array.from(list) : []
}

export const FileDrop = Extension.create({
  name: 'fileDrop',

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: fileDropKey,
        props: {
          handleDrop(view, event, _slice, moved) {
            if (moved || !editor.isEditable) return false
            const files = filesOf((event as DragEvent).dataTransfer?.files)
            if (!files.length) return false
            event.preventDefault()
            let at: number | null = null
            try {
              at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos ?? null
            } catch {
              at = null // no layout (tests): insert at the cursor
            }
            void insertFiles(editor, files, at)
            return true
          },
          handlePaste(_view, event) {
            if (!editor.isEditable) return false
            const files = filesOf(event.clipboardData?.files)
            if (!files.length) return false
            event.preventDefault()
            void insertFiles(editor, files, null)
            return true
          },
        },
      }),
    ]
  },
})
