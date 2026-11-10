// M31 item 15c: Offline & Sync "Media loading" (Everything | Required only) and the media token
// "Clear media cache" bumps, in the page's media blocks.
import { Editor as TiptapEditor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { attachment } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { MEDIA_TEXT, bumpMediaToken, resetMediaToken } from '@/settings/mediaLoading'
import { editorExtensions, loadBody } from '../document'
import { invalidateAttachments } from './upload'

const mocked = vi.mocked(api)
const editors: TiptapEditor[] = []

beforeEach(() => {
  invalidateAttachments()
  resetMediaToken()
  mocked.attachments.mockReset()
  mocked.attachments.mockResolvedValue([
    attachment({ path: 'Attachments/pixel.png', kind: 'image', size: 70 }),
    attachment({ path: 'Attachments/report.pdf', kind: 'pdf', size: 2048 }),
    attachment({ path: 'Attachments/clip.wav', kind: 'audio', size: 4096 }),
    attachment({ path: 'Attachments/clip.mp4', kind: 'video', size: 8192 }),
    attachment({ path: 'Attachments/data.xlsx', kind: 'file', size: 1536 }),
  ])
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
})

afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

async function mount(body: string): Promise<void> {
  const editor = new TiptapEditor({ extensions: editorExtensions(), editable: true })
  editors.push(editor)
  render(<EditorContent editor={editor} />)
  await act(async () => {
    loadBody(editor, body)
  })
}

const BODY = ['![pixel](Attachments/pixel.png)', '![[Attachments/report.pdf]]', '![[Attachments/clip.wav]]', '![[Attachments/clip.mp4]]', '![[Attachments/data.xlsx]]'].join('\n\n') + '\n'

describe('Media loading', () => {
  test('test everything loads media as before', async () => {
    await mount(BODY)
    const blocks = await screen.findAllByTestId('media-block')
    expect(blocks[0].querySelector('img')).not.toBeNull()
    expect(screen.queryByRole('button', { name: MEDIA_TEXT.load })).toBeNull()
  })

  test('test required only shows a placeholder with Load until clicked', async () => {
    useSettings.setState({ settings: { ...settingsDefaults, mediaLoading: 'required' } })
    const user = userEvent.setup()
    await mount(BODY)
    const blocks = await screen.findAllByTestId('media-block')
    // Image, PDF, audio and video wait; the file card is not media to load.
    await waitFor(() => expect(screen.getAllByTestId('media-placeholder')).toHaveLength(4))
    expect(document.querySelector('img.media-image, iframe, audio, video')).toBeNull()
    expect(within(blocks[4]).getByTestId('media-file')).toBeInTheDocument()

    await user.click(within(blocks[0]).getByRole('button', { name: MEDIA_TEXT.load }))
    expect(blocks[0].querySelector('img')?.getAttribute('src')).toBe('/api/file?path=Attachments%2Fpixel.png')
    expect(within(blocks[1]).getByTestId('media-placeholder')).toBeInTheDocument()
    await user.click(within(blocks[3]).getByRole('button', { name: MEDIA_TEXT.load }))
    expect(blocks[3].querySelector('video')).not.toBeNull()
  })

  test('test after clearing the media cache media load past the browser cache', async () => {
    await mount(BODY)
    const blocks = await screen.findAllByTestId('media-block')
    expect(blocks[0].querySelector('img')?.getAttribute('src')).toBe('/api/file?path=Attachments%2Fpixel.png')
    act(() => bumpMediaToken())
    await waitFor(() => expect(blocks[0].querySelector('img')?.getAttribute('src')).toMatch(/^\/api\/file\?path=Attachments%2Fpixel\.png&m=\w+$/))
  })
})
