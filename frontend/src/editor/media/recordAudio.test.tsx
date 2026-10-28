import { Editor as TiptapEditor } from '@tiptap/core'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { RECORD_TEXT, elapsedText, isRecording, recordAudio, recordingFileName } from './recordAudio'

const mocked = vi.mocked(api)
const editors: TiptapEditor[] = []

/** A MediaRecorder stand-in: `start` emits nothing; `stop` emits one chunk, then `stop`. */
class FakeRecorder extends EventTarget {
  static last: FakeRecorder | null = null
  static isTypeSupported = (t: string) => t.startsWith('audio/webm')
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  mimeType: string
  stream: MediaStream
  constructor(stream: MediaStream, opts?: { mimeType?: string }) {
    super()
    this.stream = stream
    this.mimeType = opts?.mimeType ?? 'audio/webm'
    FakeRecorder.last = this
  }
  start() {
    this.state = 'recording'
  }
  pause() {
    this.state = 'paused'
  }
  resume() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    const data = Object.assign(new Event('dataavailable'), { data: new Blob(['abc'], { type: 'audio/webm' }) })
    this.dispatchEvent(data)
    this.dispatchEvent(new Event('stop'))
  }
}

const trackStop = vi.fn()
const getUserMedia = vi.fn()

beforeEach(() => {
  FakeRecorder.last = null
  trackStop.mockClear()
  getUserMedia.mockReset()
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: trackStop }] })
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
  mocked.uploadAttachment.mockReset()
  mocked.uploadAttachment.mockImplementation(async (_b, name: string) => ({ path: `Attachments/${name}`, kind: 'video' as const }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  while (editors.length) editors.pop()!.destroy()
  document.querySelectorAll('[data-editor-toasts]').forEach((n) => n.remove())
})

function mount(body: string): TiptapEditor {
  const editor = new TiptapEditor({ element: document.createElement('div'), extensions: editorExtensions() })
  editors.push(editor)
  loadBody(editor, body)
  return editor
}

describe('recordAudio', () => {
  test('test recording file name and elapsed text', () => {
    expect(recordingFileName(new Date(2026, 9, 27, 9, 5))).toBe('Recording 2026-10-27 09-05.weba')
    expect(elapsedText(0)).toBe('0:00')
    expect(elapsedText(65_400)).toBe('1:05')
    expect(elapsedText(3_725_000)).toBe('1:02:05')
  })

  test('test recording uploads and inserts a media block', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 27, 14, 3))
    const editor = mount('First\n\nSecond\n')
    editor.commands.setTextSelection(3)
    let done!: Promise<void>
    await act(async () => {
      done = recordAudio(editor)
    })
    vi.useRealTimers()
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    const chip = await screen.findByTestId('audio-recorder')
    expect(chip).toHaveTextContent(RECORD_TEXT.recording)
    expect(isRecording()).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: RECORD_TEXT.pause }))
    expect(FakeRecorder.last!.state).toBe('paused')
    expect(chip).toHaveTextContent(RECORD_TEXT.paused)
    fireEvent.click(screen.getByRole('button', { name: RECORD_TEXT.resume }))
    expect(FakeRecorder.last!.state).toBe('recording')

    // An edit before the cursor's block meanwhile: the block still lands after "First".
    editor.commands.insertContentAt(1, 'Zero ')

    fireEvent.click(screen.getByRole('button', { name: RECORD_TEXT.stop }))
    await act(async () => {
      await done
    })
    expect(mocked.uploadAttachment).toHaveBeenCalledTimes(1)
    const [blob, name] = mocked.uploadAttachment.mock.calls[0]
    expect(name).toBe('Recording 2026-10-27 14-03.weba')
    expect((blob as Blob).size).toBe(3)
    expect((blob as Blob).type).toBe('audio/webm')
    expect(serializeBody(editor)).toBe('Zero First\n\n![[Attachments/Recording 2026-10-27 14-03.weba]]\n\nSecond\n')
    expect(trackStop).toHaveBeenCalled()
    expect(isRecording()).toBe(false)
    await waitFor(() => expect(screen.queryByTestId('audio-recorder')).toBeNull())
  })

  test('test cancel leaves no attachment', async () => {
    const body = 'Only\n'
    const editor = mount(body)
    let done!: Promise<void>
    await act(async () => {
      done = recordAudio(editor)
    })
    await screen.findByTestId('audio-recorder')
    fireEvent.click(screen.getByRole('button', { name: RECORD_TEXT.cancel }))
    await act(async () => {
      await done
    })
    expect(mocked.uploadAttachment).not.toHaveBeenCalled()
    expect(serializeBody(editor)).toBe(body)
    expect(trackStop).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId('audio-recorder')).toBeNull())
  })

  test('test denied microphone message', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    const body = 'Only\n'
    const editor = mount(body)
    await act(async () => {
      await recordAudio(editor)
    })
    expect(screen.getByRole('status')).toHaveTextContent('Microphone access was denied.')
    expect(screen.queryByTestId('audio-recorder')).toBeNull()
    expect(FakeRecorder.last).toBeNull()
    expect(mocked.uploadAttachment).not.toHaveBeenCalled()
    expect(serializeBody(editor)).toBe(body)
  })

  test('test record audio command starts a recording', async () => {
    const editor = mount('Only\n')
    await act(async () => {
      expect(editor.commands.recordAudio()).toBe(true)
    })
    await screen.findByTestId('audio-recorder')
    fireEvent.click(screen.getByRole('button', { name: RECORD_TEXT.cancel }))
    await waitFor(() => expect(isRecording()).toBe(false))
  })
})
