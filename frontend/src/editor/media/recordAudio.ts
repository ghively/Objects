/**
 * "Record audio": record from the microphone
 * into an attachment and embed it at the cursor (no transcription).
 *
 * `recordAudio(editor)` asks for the microphone (`getUserMedia({audio: true})`),
 * shows the recorder chip (`AudioRecorder`: elapsed time, pause, stop, cancel)
 * by the cursor, and resolves when the recording ends:
 * - Stop: the audio is uploaded as `Attachments/Recording <YYYY-MM-DD HH-MM>.weba`
 *   (the local start time; the server never overwrites, so a second recording
 *   in the same minute gets its own name) and a media block for it is inserted
 *   below the block the cursor was in when recording started (the position is
 *   mapped through edits made meanwhile).
 * - Cancel: nothing is uploaded and the document is unchanged.
 * - A denied (or missing) microphone shows "No permission to use the microphone."
 * Strings are ours. One recording at a time: a second call while one runs
 * resolves at once.
 */
import { Extension, type Editor } from '@tiptap/core'
import { TextSelection, type Transaction } from '@tiptap/pm/state'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { api } from '@/api/client'
import { AudioRecorder, RECORD_TEXT, type RecordingControls } from './AudioRecorder'
import { MAX_UPLOAD_BYTES, UPLOAD_LIMIT_MESSAGE, invalidateAttachments, showToast } from './upload'

export { RECORD_TEXT, elapsedText, type RecordingControls } from './AudioRecorder'

const pad = (n: number) => String(n).padStart(2, '0')

/** The attachment name for a recording started at `d` (local time): `Recording YYYY-MM-DD HH-MM.weba` (WebM audio; `.webm` would read back as video). */
export function recordingFileName(d: Date): string {
  return `Recording ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}.weba`
}

let active: Promise<void> | null = null

/** Whether a recording is running (tests). */
export function isRecording(): boolean {
  return active !== null
}

function pickMimeType(): string | undefined {
  const MR = globalThis.MediaRecorder as (typeof MediaRecorder & { isTypeSupported?: (t: string) => boolean }) | undefined
  for (const t of ['audio/webm;codecs=opus', 'audio/webm']) {
    try {
      if (MR?.isTypeSupported?.(t)) return t
    } catch {
      /* ignore */
    }
  }
  return undefined
}

/** The chip's host: fixed by the cursor (or the editor's top) while recording. */
function mountChip(editor: Editor, controls: RecordingControls): { root: Root; host: HTMLElement } {
  const host = document.createElement('div')
  host.setAttribute('data-audio-recorder-host', '')
  host.style.position = 'fixed'
  host.style.zIndex = '60'
  let top = 16
  let left = 16
  try {
    const c = editor.view.coordsAtPos(editor.state.selection.from)
    top = c.bottom + 6
    left = c.left
  } catch {
    try {
      const r = (editor.view.dom as HTMLElement).getBoundingClientRect()
      top = r.top
      left = r.left
    } catch {
      /* keep the corner */
    }
  }
  host.style.top = `${Math.max(0, top)}px`
  host.style.left = `${Math.max(0, left)}px`
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(createElement(AudioRecorder, { controls }))
  return { root, host }
}

/** Start recording for `editor`; the recording lands as a media block at the cursor. */
export function recordAudio(editor: Editor): Promise<void> {
  if (active) return Promise.resolve()
  const run = record(editor).finally(() => {
    active = null
  })
  active = run
  return run
}

async function record(editor: Editor): Promise<void> {
  const getUserMedia = globalThis.navigator?.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
  if (!getUserMedia || typeof globalThis.MediaRecorder === 'undefined') {
    showToast(RECORD_TEXT.denied)
    return
  }
  let stream: MediaStream
  try {
    stream = await getUserMedia({ audio: true })
  } catch {
    showToast(RECORD_TEXT.denied)
    return
  }
  if (editor.isDestroyed) {
    stream.getTracks().forEach((t) => t.stop())
    return
  }

  const startedAt = new Date()
  const mimeType = pickMimeType()
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.addEventListener('dataavailable', (e: BlobEvent) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  })

  // Where the block goes: the cursor at the start, mapped through later edits.
  let at = editor.state.selection.from
  const track = ({ transaction }: { transaction: Transaction }) => {
    at = transaction.mapping.map(at)
  }
  editor.on('transaction', track)

  // Elapsed time, pauses excluded.
  let runningSince: number | null = Date.now()
  let banked = 0
  const controls: RecordingControls = {
    elapsed: () => banked + (runningSince != null ? Date.now() - runningSince : 0),
    paused: () => recorder.state === 'paused',
    pause: () => {
      if (recorder.state !== 'recording') return
      recorder.pause()
      if (runningSince != null) banked += Date.now() - runningSince
      runningSince = null
    },
    resume: () => {
      if (recorder.state !== 'paused') return
      recorder.resume()
      runningSince = Date.now()
    },
    stop: () => {},
    cancel: () => {},
  }
  const wired = wireOutcome(recorder, controls, () => {
    if (runningSince != null) banked += Date.now() - runningSince
    runningSince = null
  })

  recorder.start(1000)
  const chip = mountChip(editor, controls)
  const onDestroy = () => controls.cancel()
  editor.on('destroy', onDestroy)

  let how: 'stop' | 'cancel'
  try {
    how = await wired
  } finally {
    stream.getTracks().forEach((t) => t.stop())
    editor.off('transaction', track)
    editor.off('destroy', onDestroy)
    queueMicrotask(() => {
      chip.root.unmount()
      chip.host.remove()
    })
  }
  if (how === 'cancel' || editor.isDestroyed) return

  const blob = new Blob(chunks, { type: (mimeType ?? recorder.mimeType ?? 'audio/webm').split(';')[0] || 'audio/webm' })
  if (blob.size > MAX_UPLOAD_BYTES) {
    showToast(UPLOAD_LIMIT_MESSAGE)
    return
  }
  let path: string
  try {
    const res = await api.uploadAttachment(blob, recordingFileName(startedAt))
    invalidateAttachments()
    path = res.path
  } catch (err) {
    showToast(err instanceof Error && err.message ? err.message : RECORD_TEXT.failed)
    return
  }
  if (editor.isDestroyed) return
  const pos = Math.max(0, Math.min(at, editor.state.doc.content.size))
  editor
    .chain()
    .command(({ tr }) => {
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos)))
      return true
    })
    .insertMedia({ form: 'wiki', target: path, kind: 'audio' })
    .run()
}

/** Resolve with how the recording ended once the recorder has stopped (stop or cancel). */
function wireOutcome(recorder: MediaRecorder, controls: RecordingControls, bank: () => void): Promise<'stop' | 'cancel'> {
  return new Promise((resolve) => {
    let decided = false
    const finish = (how: 'stop' | 'cancel') => {
      if (decided) return
      decided = true
      bank()
      if (recorder.state === 'inactive') return resolve(how)
      recorder.addEventListener('stop', () => resolve(how), { once: true })
      try {
        recorder.stop()
      } catch {
        resolve(how)
      }
    }
    controls.stop = () => finish('stop')
    controls.cancel = () => finish('cancel')
  })
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    recordAudio: {
      /** Start an audio recording that is embedded at the cursor when it stops. */
      recordAudio: () => ReturnType
    }
  }
}

/** The `recordAudio` command: hands the editor to `recordAudio`. */
export const RecordAudio = Extension.create({
  name: 'recordAudio',
  addCommands() {
    return {
      recordAudio:
        () =>
        ({ editor }) => {
          if (!editor.isEditable) return false
          void recordAudio(editor).catch((err: unknown) => console.warn('Recording failed:', err))
          return true
        },
    }
  },
})
