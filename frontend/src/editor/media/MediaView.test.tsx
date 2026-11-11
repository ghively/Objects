import { Editor as TiptapEditor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { attachment } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { FILE_NOT_FOUND, IMAGE_ERROR } from './MediaView'
import { invalidateAttachments } from './upload'

const mocked = vi.mocked(api)
const editors: TiptapEditor[] = []

const ATTACHMENTS = [
  attachment({ path: 'Attachments/pixel.png', kind: 'image', size: 70 }),
  attachment({ path: 'Attachments/report.pdf', kind: 'pdf', size: 2048 }),
  attachment({ path: 'Attachments/clip.wav', kind: 'audio', size: 4096 }),
  attachment({ path: 'Attachments/clip.mp4', kind: 'video', size: 8192 }),
  attachment({ path: 'Attachments/data.xlsx', kind: 'file', size: 1536 }),
]

beforeEach(() => {
  invalidateAttachments()
  mocked.attachments.mockReset()
  mocked.attachments.mockResolvedValue(ATTACHMENTS)
  mocked.openAttachment.mockClear()
})

afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

async function mount(body: string, editable = true): Promise<TiptapEditor> {
  const editor = new TiptapEditor({ extensions: editorExtensions(), editable })
  editors.push(editor)
  render(<EditorContent editor={editor} />)
  await act(async () => {
    loadBody(editor, body)
  })
  return editor
}

function pointer(el: Element, type: string, x: number, y: number) {
  fireEvent(el, new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1 }))
}

const fileUrl = (p: string) => `/api/file?path=${encodeURIComponent(p)}`

describe('MediaView', () => {
  test('test image, pdf, audio, video and file render from their nodes', async () => {
    const body = [
      '![pixel](Attachments/pixel.png)',
      '![[Attachments/report.pdf]]',
      '![[Attachments/clip.wav]]',
      '![[Attachments/clip.mp4]]',
      '![[Attachments/data.xlsx]]',
      '![remote](https://example.com/a.png)',
      '![[pixel.png]]',
    ].join('\n\n')
    await mount(body + '\n')
    const blocks = await screen.findAllByTestId('media-block')
    expect(blocks.map((b) => b.getAttribute('data-kind'))).toEqual(['image', 'pdf', 'audio', 'video', 'file', 'image', 'image'])

    const img = blocks[0].querySelector('img')!
    expect(img.getAttribute('src')).toBe(fileUrl('Attachments/pixel.png'))
    expect(img.getAttribute('alt')).toBe('pixel')

    await waitFor(() => expect(blocks[1].querySelector('iframe')?.getAttribute('src')).toBe(fileUrl('Attachments/report.pdf')))
    expect(blocks[1].querySelector('iframe')!.style.height).toBe('600px')
    await waitFor(() => expect(blocks[2].querySelector('audio')?.getAttribute('src')).toBe(fileUrl('Attachments/clip.wav')))
    expect(blocks[2].querySelector('audio')!.hasAttribute('controls')).toBe(true)
    await waitFor(() => expect(blocks[3].querySelector('video')?.getAttribute('src')).toBe(fileUrl('Attachments/clip.mp4')))

    const card = await within(blocks[4]).findByTestId('media-file')
    expect(card).toHaveTextContent('data.xlsx')
    await waitFor(() => expect(card).toHaveTextContent('1.5 KB'))

    // An http(s) image is loaded as written; an Obsidian short name finds its attachment.
    expect(blocks[5].querySelector('img')!.getAttribute('src')).toBe('https://example.com/a.png')
    await waitFor(() => expect(blocks[6].querySelector('img')?.getAttribute('src')).toBe(fileUrl('Attachments/pixel.png')))
    // One attachments call is shared by every block.
    expect(mocked.attachments).toHaveBeenCalledTimes(1)
  })

  test('test resize, align and caption write their options on release', async () => {
    const body = 'Intro\n\n<!-- block: width=120 -->\n![pixel](Attachments/pixel.png)\n\nOutro\n'
    const editor = await mount(body)
    await screen.findByTestId('media-block')

    // Resize: nothing is written while dragging; the width is written once on release.
    const handle = screen.getByRole('separator', { name: 'Resize width' })
    pointer(handle, 'pointerdown', 100, 0)
    pointer(handle, 'pointermove', 130, 0)
    pointer(handle, 'pointermove', 150, 0)
    expect(screen.getByTestId('resizable-embed').querySelector('.resizable-embed-frame')!.getAttribute('data-width')).toBe('170')
    expect(serializeBody(editor)).toBe(body)
    pointer(handle, 'pointerup', 150, 0)
    expect(serializeBody(editor)).toBe('Intro\n\n<!-- block: width=170 -->\n![pixel](Attachments/pixel.png)\n\nOutro\n')

    // Align: center writes align, left removes it.
    fireEvent.click(screen.getByRole('button', { name: 'Align center' }))
    expect(serializeBody(editor)).toBe('Intro\n\n<!-- block: align=center width=170 -->\n![pixel](Attachments/pixel.png)\n\nOutro\n')
    await waitFor(() => expect(screen.getByTestId('resizable-embed')).toHaveAttribute('data-align', 'center'))
    fireEvent.click(screen.getByRole('button', { name: 'Align left' }))
    expect(serializeBody(editor)).toBe('Intro\n\n<!-- block: width=170 -->\n![pixel](Attachments/pixel.png)\n\nOutro\n')

    // Caption: "Add caption" opens an empty field ("Caption..."), written on blur.
    await waitFor(() => expect(screen.getByTestId('resizable-embed')).toHaveAttribute('data-align', 'left'))
    fireEvent.click(screen.getByRole('button', { name: 'Add caption' }))
    const input = await screen.findByPlaceholderText('Caption...')
    fireEvent.change(input, { target: { value: 'A "tiny" pixel' } })
    expect(serializeBody(editor)).toBe('Intro\n\n<!-- block: width=170 -->\n![pixel](Attachments/pixel.png)\n\nOutro\n')
    fireEvent.blur(input)
    expect(serializeBody(editor)).toBe(
      'Intro\n\n<!-- block: width=170 caption="A \\"tiny\\" pixel" -->\n![pixel](Attachments/pixel.png)\n\nOutro\n',
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Remove caption' }))
    expect(serializeBody(editor)).toBe('Intro\n\n<!-- block: width=170 -->\n![pixel](Attachments/pixel.png)\n\nOutro\n')

    // Undo of the caption removal brings back the exact annotation; undoing everything restores the bytes.
    while (editor.can().undo()) editor.commands.undo()
    expect(serializeBody(editor)).toBe(body)
  })

  test('test pdf height handle writes height on release', async () => {
    const editor = await mount('![[Attachments/report.pdf]]\n')
    await screen.findByTestId('media-block')
    const handle = screen.getByRole('separator', { name: 'Resize height' })
    pointer(handle, 'pointerdown', 0, 600)
    pointer(handle, 'pointermove', 0, 500)
    await waitFor(() => expect(screen.getByTitle('report.pdf').style.height).toBe('500px'))
    expect(serializeBody(editor)).toBe('![[Attachments/report.pdf]]\n')
    pointer(handle, 'pointerup', 0, 500)
    expect(serializeBody(editor)).toBe('<!-- block: height=500 -->\n![[Attachments/report.pdf]]\n')
  })

  test('test missing image and missing file states', async () => {
    mocked.attachments.mockResolvedValue([])
    await mount('![gone](Attachments/gone.png)\n\n![[Attachments/gone.xlsx]]\n\n![[Attachments/gone.pdf]]\n')
    const blocks = await screen.findAllByTestId('media-block')
    fireEvent.error(blocks[0].querySelector('img')!)
    expect(await within(blocks[0]).findByText(IMAGE_ERROR)).toBeInTheDocument()
    expect(await within(blocks[1]).findByText(FILE_NOT_FOUND)).toBeInTheDocument()
    expect(await within(blocks[2]).findByText(FILE_NOT_FOUND)).toBeInTheDocument()
    expect(blocks[2].querySelector('iframe')).toBeNull()
  })

  test('test open on system and download for files', async () => {
    await mount('![[Attachments/data.xlsx]]\n')
    const open = await screen.findByRole('button', { name: 'Open file on system' })
    fireEvent.click(open)
    await waitFor(() => expect(mocked.openAttachment).toHaveBeenCalledWith('Attachments/data.xlsx'))
    const download = screen.getByRole('link', { name: 'Download file' })
    expect(download).toHaveAttribute('download', 'data.xlsx')
    expect(download).toHaveAttribute('href', fileUrl('Attachments/data.xlsx'))
    // The menu has it too.
    fireEvent.click(screen.getByRole('button', { name: 'Block menu' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open file on system' }))
    await waitFor(() => expect(mocked.openAttachment).toHaveBeenCalledTimes(2))
  })

  test('test remove block from the menu', async () => {
    const editor = await mount('Intro\n\n![[Attachments/clip.wav]]\n\nOutro\n')
    await screen.findByTestId('media-block')
    fireEvent.click(screen.getByRole('button', { name: 'Block menu' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove Block' }))
    expect(serializeBody(editor)).toBe('Intro\n\nOutro\n')
  })

  test('test read-only editors show no controls', async () => {
    await mount('<!-- block: caption=Hello -->\n![pixel](Attachments/pixel.png)\n', false)
    await screen.findByTestId('media-block')
    expect(screen.queryByRole('separator')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Align center' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Block menu' })).toBeNull()
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  test('test bookmark card opens externally and fetches nothing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      await mount('<!-- block: bookmark -->\n[Proxmox docs](https://www.pve.proxmox.com/wiki)\n')
      const card = await screen.findByTestId('bookmark-block')
      const link = within(card).getByRole('link')
      expect(link).toHaveAttribute('href', 'https://www.pve.proxmox.com/wiki')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(link).toHaveTextContent('Proxmox docs')
      expect(link).toHaveTextContent('pve.proxmox.com')
      expect(link).toHaveTextContent('https://www.pve.proxmox.com/wiki')
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test('test bookmark with a script URL renders no href', async () => {
    await mount('<!-- block: bookmark -->\n[x](javascript:void0)\n')
    const card = await screen.findByTestId('bookmark-block')
    expect(card.querySelector('a')!.hasAttribute('href')).toBe(false)
  })

  // M32 item 4: a small pasted or dropped image keeps its own size.
  /** The image reports its own size, as the browser does once it has loaded. */
  function loaded(img: HTMLImageElement, naturalWidth: number) {
    Object.defineProperty(img, 'naturalWidth', { value: naturalWidth, configurable: true })
    fireEvent.load(img)
  }

  test('test an image with no width set is shown at its own width, never wider (M32)', async () => {
    const body = 'Intro\n\n![pixel](Attachments/pixel.png)\n\nOutro\n'
    const editor = await mount(body)
    const block = await screen.findByTestId('media-block')
    const frame = block.querySelector<HTMLElement>('.resizable-embed-frame')!
    const img = block.querySelector('img')!
    expect(frame.style.width).toBe('') // before it loads: no size of its own yet
    loaded(img, 48)
    expect(frame.style.width).toBe('48px')
    expect(frame.style.maxWidth).toBe('100%') // a wide image is still held to the text column
    expect(frame.getAttribute('data-natural')).toBe('')
    // Nothing is written for it: the size is the picture's, not an option.
    expect(frame.hasAttribute('data-width')).toBe(false)
    expect(serializeBody(editor)).toBe(body)
  })

  test('test a width the user set wins over the image\'s own (M32)', async () => {
    const body = 'Intro\n\n<!-- block: width=300 -->\n![pixel](Attachments/pixel.png)\n\nOutro\n'
    const editor = await mount(body)
    const block = await screen.findByTestId('media-block')
    const frame = block.querySelector<HTMLElement>('.resizable-embed-frame')!
    loaded(block.querySelector('img')!, 48)
    expect(frame.style.width).toBe('300px')
    expect(frame.getAttribute('data-width')).toBe('300')
    expect(frame.hasAttribute('data-natural')).toBe(false)
    expect(serializeBody(editor)).toBe(body)
  })

  test('test resizing an unsized image starts from its own width and writes the new one (M32)', async () => {
    const editor = await mount('![pixel](Attachments/pixel.png)\n')
    const block = await screen.findByTestId('media-block')
    loaded(block.querySelector('img')!, 200)
    const handle = screen.getByRole('separator', { name: 'Resize width' })
    pointer(handle, 'pointerdown', 200, 10)
    pointer(handle, 'pointermove', 260, 10)
    pointer(handle, 'pointerup', 260, 10)
    expect(serializeBody(editor)).toBe('<!-- block: width=260 -->\n![pixel](Attachments/pixel.png)\n')
  })

  test('test another picture in the same block is measured again (M32)', async () => {
    await mount('![pixel](Attachments/pixel.png)\n')
    const block = await screen.findByTestId('media-block')
    const frame = block.querySelector<HTMLElement>('.resizable-embed-frame')!
    loaded(block.querySelector('img')!, 48)
    expect(frame.style.width).toBe('48px')
    loaded(block.querySelector('img')!, 640)
    expect(frame.style.width).toBe('640px')
  })
})
