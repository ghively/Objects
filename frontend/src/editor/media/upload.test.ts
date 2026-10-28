import { Editor as TiptapEditor } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { classifyEmbedLine } from '../annotations'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { insertFiles } from '../extensions/fileDrop'
import {
  ACCEPT,
  MAX_UPLOAD_BYTES,
  UPLOAD_LIMIT_MESSAGE,
  decodeMarkdownPath,
  encodeMarkdownPath,
  findAttachment,
  mediaAttrsForUpload,
} from './upload'

const mocked = vi.mocked(api)
const editors: TiptapEditor[] = []

function headless(body: string): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  editors.push(editor)
  loadBody(editor, body)
  return editor
}

function file(name: string, size?: number): File {
  const f = new File(['x'], name)
  if (size !== undefined) Object.defineProperty(f, 'size', { value: size })
  return f
}

function choose(kind: string, files: File[]) {
  const input = document.querySelector<HTMLInputElement>(`input[data-media-picker="${kind}"]`)
  expect(input).not.toBeNull()
  Object.defineProperty(input!, 'files', { value: files })
  input!.dispatchEvent(new Event('change'))
  return input!
}

// A block inserted after the last one ends the file without the old trailing newline (Task 7's
// serializer); these tests are about what is inserted where, so they compare without it.
const body = (editor: TiptapEditor) => serializeBody(editor).replace(/\n$/, '')

const toasts = () => Array.from(document.querySelectorAll('.editor-toast')).map((t) => t.textContent)

beforeEach(() => {
  mocked.uploadAttachment.mockReset()
  mocked.uploadAttachment.mockImplementation(async (_b, name: string) => ({
    path: `Attachments/${name}`,
    kind: (await import('../annotations')).attachmentKind(name),
  }))
})

afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
  document.querySelectorAll('[data-media-picker], [data-editor-toasts]').forEach((el) => el.remove())
})

describe('upload helpers', () => {
  test('media attributes per kind, with escaped Markdown paths that still read as images', () => {
    const img = mediaAttrsForUpload('Attachments/My shot (1).png', 'image', 'My shot (1).png')
    expect(img).toEqual({ form: 'md', src: 'Attachments/My%20shot%20%281%29.png', alt: 'My shot (1)', kind: 'image' })
    const line = `![${img.alt}](${img.src})`
    expect(classifyEmbedLine(line)).toEqual({ kind: 'image', alt: 'My shot (1)', src: img.src })
    expect(decodeMarkdownPath(img.src!)).toBe('Attachments/My shot (1).png')
    expect(decodeMarkdownPath('bad%zz')).toBe('bad%zz')
    expect(encodeMarkdownPath('a%b')).toBe('a%25b')
    expect(mediaAttrsForUpload('Attachments/r.pdf', 'pdf', 'r.pdf')).toEqual({ form: 'wiki', target: 'Attachments/r.pdf', kind: 'pdf' })
  })

  test('findAttachment matches exact paths, then a unique short name', () => {
    const list = [
      { path: 'Attachments/a.pdf', kind: 'pdf' as const, size: 1 },
      { path: 'Other/B.png', kind: 'image' as const, size: 1 },
    ]
    expect(findAttachment(list, 'Attachments/a.pdf')?.path).toBe('Attachments/a.pdf')
    expect(findAttachment(list, 'b.png')?.path).toBe('Other/B.png')
    expect(findAttachment(list, 'Nope/a.pdf')).toBeUndefined()
  })
})

describe('pickMedia', () => {
  test('test pickMedia uploads and inserts the right form per kind', async () => {
    const editor = headless('Intro\n')
    editor.commands.setTextSelection(3)

    expect(editor.commands.pickMedia('image')).toBe(true)
    const input = document.querySelector<HTMLInputElement>('input[data-media-picker="image"]')!
    expect(input.type).toBe('file')
    expect(input.accept).toBe(ACCEPT.image)
    choose('image', [file('My shot.png')])
    await vi.waitFor(() => expect(body(editor)).toBe('Intro\n\n![My shot](Attachments/My%20shot.png)'))
    expect(mocked.uploadAttachment).toHaveBeenCalledWith(expect.any(File), 'My shot.png')
    expect(document.querySelector('input[data-media-picker]')).toBeNull()

    for (const [kind, name] of [
      ['pdf', 'report.pdf'],
      ['audio', 'clip.wav'],
      ['video', 'clip.mp4'],
      ['file', 'data.xlsx'],
    ] as const) {
      editor.commands.pickMedia(kind)
      const el = document.querySelector<HTMLInputElement>(`input[data-media-picker="${kind}"]`)!
      expect(el.accept).toBe(ACCEPT[kind])
      choose(kind, [file(name)])
      await vi.waitFor(() => expect(body(editor)).toContain(`![[Attachments/${name}]]`))
    }
    expect(body(editor)).toBe(
      'Intro\n\n![My shot](Attachments/My%20shot.png)\n\n![[Attachments/report.pdf]]\n\n![[Attachments/clip.wav]]\n\n' +
        '![[Attachments/clip.mp4]]\n\n![[Attachments/data.xlsx]]',
    )
    const kinds: string[] = []
    editor.state.doc.forEach((n) => {
      if (n.type.name === 'media') kinds.push(n.attrs.kind)
    })
    expect(kinds).toEqual(['image', 'pdf', 'audio', 'video', 'file'])
  })

  test('test upload over 100 MiB is refused before sending', async () => {
    const editor = headless('Intro\n')
    editor.commands.pickMedia('video')
    choose('video', [file('huge.mp4', MAX_UPLOAD_BYTES + 1)])
    await vi.waitFor(() => expect(toasts()).toContain(UPLOAD_LIMIT_MESSAGE))
    expect(mocked.uploadAttachment).not.toHaveBeenCalled()
    expect(body(editor)).toBe('Intro')
  })

  test('a failed upload inserts nothing and says why', async () => {
    mocked.uploadAttachment.mockRejectedValue(new Error('Request failed'))
    const editor = headless('Intro\n')
    editor.commands.pickMedia('file')
    choose('file', [file('a.bin')])
    await vi.waitFor(() => expect(toasts()).toContain('Request failed'))
    expect(body(editor)).toBe('Intro')
  })
})

describe('fileDrop', () => {
  test('test dropped and pasted files upload and insert media blocks', async () => {
    const editor = headless('First\n\nSecond\n')
    editor.commands.setTextSelection(2)
    const view = editor.view

    // Paste: below the block at the cursor, with the "Insert image" toast.
    const paste = new Event('paste', { cancelable: true }) as ClipboardEvent
    Object.defineProperty(paste, 'clipboardData', { value: { files: [file('shot.png')] } })
    const handledPaste = view.someProp('handlePaste', (f) => f(view, paste, Slice.empty))
    expect(handledPaste).toBe(true)
    expect(toasts()).toContain('Insert image')
    await vi.waitFor(() => expect(body(editor)).toBe('First\n\n![shot](Attachments/shot.png)\n\nSecond'))

    // Drop (no layout in tests, so at the cursor): "Insert file".
    editor.commands.setTextSelection(editor.state.doc.content.size - 2)
    const drop = new Event('drop', { cancelable: true }) as DragEvent
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file('a.xlsx'), file('b.pdf')] } })
    const handledDrop = view.someProp('handleDrop', (f) => f(view, drop, Slice.empty, false))
    expect(handledDrop).toBe(true)
    expect(toasts()).toContain('Insert file')
    await vi.waitFor(() =>
      expect(body(editor)).toBe('First\n\n![shot](Attachments/shot.png)\n\nSecond\n\n![[Attachments/a.xlsx]]\n\n![[Attachments/b.pdf]]'),
    )

    // Text drops and moves are left to ProseMirror.
    const textDrop = new Event('drop', { cancelable: true }) as DragEvent
    Object.defineProperty(textDrop, 'dataTransfer', { value: { files: [] } })
    expect(view.someProp('handleDrop', (f) => f(view, textDrop, Slice.empty, false))).toBeFalsy()
  })

  test('the drop point follows edits made while uploading', async () => {
    let release!: () => void
    mocked.uploadAttachment.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ path: 'Attachments/late.pdf', kind: 'pdf' })
        }),
    )
    const editor = headless('First\n\nSecond\n')
    // The drop point: inside "Second".
    const second = editor.state.doc.child(0).nodeSize + 2
    const done = insertFiles(editor, [file('late.pdf')], second)
    // Type at the start of the document before the upload finishes.
    editor.commands.insertContentAt(1, 'New ')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release()
    await done
    expect(body(editor)).toBe('New First\n\nSecond\n\n![[Attachments/late.pdf]]')
  })
})
