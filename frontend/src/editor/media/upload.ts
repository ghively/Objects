/**
 * Uploading files into the space for media blocks: the file picker per kind,
 * the 100 MiB limit (checked before anything is sent), the upload itself
 * (`api.uploadAttachment`, which copies into `Attachments/` and never
 * overwrites) and the media-block attributes for the uploaded path.
 *
 * Also a tiny cache of `api.attachments()` (file sizes, "File not found.")
 * shared by every media view, dropped after each upload, and a minimal toast
 * (the app has no global toast; this one needs no host component).
 */
import type { Editor } from '@tiptap/core'
import { api } from '@/api/client'
import type { Attachment } from '@/api/types'
import { attachmentKind, type AttachmentKind } from '../annotations'
import type { MediaAttrs } from '../nodes/media'

/** Capacities' limit (`EntityPicker.uploadLimitSize`); the back end answers 413 above it. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

/** `EntityPicker.uploadLimitSize`, verbatim. */
export const UPLOAD_LIMIT_MESSAGE =
  'You can only upload files up to 100 MiB in size. If your file is bigger than that, it will fail.'

/** The `accept` list of the file input, per kind (`file` takes anything). */
export const ACCEPT: Record<AttachmentKind, string> = {
  image: 'image/*,.png,.jpg,.jpeg,.gif,.webp,.svg',
  pdf: 'application/pdf,.pdf',
  audio: 'audio/*,.mp3,.wav,.m4a,.ogg,.oga,.flac,.aac,.opus',
  video: 'video/*,.mp4,.webm,.mov,.m4v,.ogv',
  file: '',
}

// ---- toast ----------------------------------------------------------------

const TOAST_MS = 4000

/** Show a short message at the bottom of the window (our minimal toast). */
export function showToast(text: string): void {
  if (typeof document === 'undefined') return
  let host = document.querySelector<HTMLElement>('[data-editor-toasts]')
  if (!host) {
    host = document.createElement('div')
    host.setAttribute('data-editor-toasts', '')
    host.className = 'editor-toasts'
    document.body.appendChild(host)
  }
  const el = document.createElement('div')
  el.className = 'editor-toast'
  el.setAttribute('role', 'status')
  el.textContent = text
  host.appendChild(el)
  setTimeout(() => el.remove(), TOAST_MS)
}

// ---- attachments cache ----------------------------------------------------

let attachmentsCache: Promise<Attachment[]> | null = null

/** Every attachment in the space, fetched once and shared until the next upload. */
export function cachedAttachments(): Promise<Attachment[]> {
  attachmentsCache ??= api.attachments().catch(() => {
    attachmentsCache = null
    return []
  })
  return attachmentsCache
}

/** Forget the cached list (after an upload; tests). */
export function invalidateAttachments(): void {
  attachmentsCache = null
}

/**
 * The attachment a block's path names: the exact space path, else (Obsidian's
 * short form, `![[report.pdf]]`) the one attachment with that file name.
 */
export function findAttachment(list: Attachment[], path: string): Attachment | undefined {
  const exact = list.find((a) => a.path === path)
  if (exact) return exact
  const lower = path.toLowerCase()
  const exactCi = list.find((a) => a.path.toLowerCase() === lower)
  if (exactCi) return exactCi
  if (path.includes('/')) return undefined
  return list.find((a) => (a.path.split('/').pop() ?? '').toLowerCase() === lower)
}

// ---- paths and attributes -------------------------------------------------

/** A space path as a Markdown link destination: spaces and parentheses escaped, so `![…](…)` stays one token. */
export function encodeMarkdownPath(path: string): string {
  return path.replace(/%/g, '%25').replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
}

/** The space path a Markdown image destination names (percent escapes undone when they decode). */
export function decodeMarkdownPath(src: string): string {
  try {
    return decodeURIComponent(src)
  } catch {
    return src
  }
}

export function isExternalUrl(src: string): boolean {
  return /^https?:\/\//i.test(src)
}

function stem(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  return base.replace(/\.[^.]+$/, '')
}

/** The media block for an uploaded file: `![name](Attachments/…)` for an image, `![[Attachments/…]]` otherwise. */
export function mediaAttrsForUpload(path: string, kind: AttachmentKind, name: string): MediaAttrs {
  if (kind === 'image') return { form: 'md', src: encodeMarkdownPath(path), alt: stem(name), kind }
  return { form: 'wiki', target: path, kind }
}

// ---- upload ---------------------------------------------------------------

/**
 * Upload one file. Over 100 MiB it is refused before sending (the toast
 * `EntityPicker.uploadLimitSize`) and resolves `null`; a failed upload shows
 * the server's message and resolves `null`.
 */
export async function uploadFile(file: File): Promise<MediaAttrs | null> {
  if (file.size > MAX_UPLOAD_BYTES) {
    showToast(UPLOAD_LIMIT_MESSAGE)
    return null
  }
  try {
    const res = await api.uploadAttachment(file, file.name)
    invalidateAttachments()
    return mediaAttrsForUpload(res.path, res.kind ?? attachmentKind(res.path), file.name)
  } catch (err) {
    showToast(err instanceof Error && err.message ? err.message : 'The file could not be uploaded.')
    return null
  }
}

/** Upload `file` and insert its media block below the block at the selection. */
export async function uploadAndInsert(editor: Editor, file: File): Promise<boolean> {
  const attrs = await uploadFile(file)
  if (!attrs || editor.isDestroyed) return false
  return editor.chain().insertMedia(attrs).run()
}

/**
 * Open the system file dialog for `kind` (a hidden `<input type=file>`); the
 * chosen files are handed to `onFiles`. The input stays in the document until
 * a choice or a cancel, so tests can drive it.
 */
export function openFilePicker(kind: AttachmentKind, onFiles: (files: File[]) => void): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'file'
  if (ACCEPT[kind]) input.accept = ACCEPT[kind]
  input.setAttribute('data-media-picker', kind)
  input.style.display = 'none'
  const done = () => input.remove()
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? [])
    done()
    if (files.length) onFiles(files)
  })
  input.addEventListener('cancel', done)
  document.body.appendChild(input)
  input.click()
  return input
}

/** `pickMedia(kind)`: choose a file, upload it and insert its block. */
export function pickAndInsert(editor: Editor, kind: AttachmentKind): void {
  openFilePicker(kind, (files) => {
    void (async () => {
      for (const f of files) await uploadAndInsert(editor, f)
    })()
  })
}
