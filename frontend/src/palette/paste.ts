/**
 * The action palette's clipboard group (`CommandPalette.paste.*`, M8 Task 17).
 *
 * What the clipboard holds decides the offers:
 * - text: "Add to today's daily note" (preview "1 block | {count} blocks"; appends to today's
 *   note, creating it; "Added content to daily note") and "Create new page with content";
 * - Markdown with a heading: also "Create page", titled with the first heading (which then leaves
 *   the body; our choice);
 * - a URL: also "Create {structureName}" for Page: a page titled with the URL's host and path
 *   holding one bookmark block. The URL is **never fetched** (our choice: no network at runtime);
 * - files or an image: "Upload" (copied to `Attachments/`; no image object is created, as media
 *   are attachments in our model; our choice).
 *
 * A denied clipboard read shows "Clipboard access was denied." (our string) and offers nothing.
 */
import { api, DailyNoteExistsError } from '@/api/client'
import type { TypeDef } from '@/api/types'
import { todayYmd } from '@/calendar/dates'
import { openObject } from '@/create/createAndOpen'
import { splitBlocks } from '@/editor/blocks'
import { showToast } from '@/editor/media/upload'
import { bookmarkMarkdown } from '@/editor/nodes/bookmark'
import { invalidateLinkIndex } from '@/links/linkIndex'

/** Object's strings, verbatim (`CommandPalette.paste.*`), plus our denial line. */
export const PASTE_TEXT = {
  addToDailyNote: "Add to today's daily note",
  blocks: (count: number) => (count === 1 ? '1 block' : `${count} blocks`),
  addedToDailyNote: 'Added content to daily note',
  upload: 'Upload',
  createHttpLinkEntity: (structureName: string) => `Create ${structureName}`,
  createPageFromMd: 'Create page',
  createPageWithBlocks: 'Create new page with content',
  denied: 'Clipboard access was denied.', // our string
} as const

export type ClipboardContent =
  | { kind: 'denied' }
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  | { kind: 'files'; files: File[] }

function extensionFor(mime: string): string {
  const sub = mime.split('/')[1]?.split(/[+;]/)[0]?.trim()
  if (!sub) return 'bin'
  return sub === 'jpeg' ? 'jpg' : sub
}

/**
 * Read the clipboard: files (images) first through `navigator.clipboard.read`, else its text.
 * Any refusal (permission denied, no clipboard API) reads as `denied`.
 */
export async function readClipboard(clip: Clipboard | undefined = globalThis.navigator?.clipboard): Promise<ClipboardContent> {
  if (!clip) return { kind: 'denied' }
  try {
    if (typeof clip.read === 'function') {
      const items = await clip.read()
      const files: File[] = []
      let text: string | null = null
      for (const item of items) {
        const fileType = item.types.find((t) => !t.startsWith('text/'))
        if (fileType) {
          const blob = await item.getType(fileType)
          files.push(new File([blob], `Pasted ${files.length + 1}.${extensionFor(fileType)}`, { type: fileType }))
        } else if (text === null && item.types.includes('text/plain')) {
          text = await (await item.getType('text/plain')).text()
        }
      }
      if (files.length) return { kind: 'files', files }
      if (text !== null) return text.trim() ? { kind: 'text', text } : { kind: 'empty' }
      return { kind: 'empty' }
    }
    const text = await clip.readText()
    return text.trim() ? { kind: 'text', text } : { kind: 'empty' }
  } catch {
    return { kind: 'denied' }
  }
}

/** A single `http(s)` URL (the whole trimmed text), else null. */
export function pastedUrl(text: string): URL | null {
  const t = text.trim()
  if (!/^https?:\/\/\S+$/i.test(t)) return null
  try {
    const u = new URL(t)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/

/** The first ATX heading's text and line index, or null. */
export function firstHeading(text: string): { title: string; line: number } | null {
  const lines = text.split(/\r\n?|\n/)
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    if (/^ {0,3}(```|~~~)/.test(lines[i])) fence = !fence
    if (fence) continue
    const m = HEADING.exec(lines[i])
    if (m) return { title: m[2].trim(), line: i }
  }
  return null
}

/** How many blocks the text makes (blank space between blocks is not a block). */
export function countBlocks(text: string): number {
  return splitBlocks(text).filter((b) => b.kind !== 'space' && b.raw.trim() !== '').length
}

/** The page title for a pasted URL: its host and path, without a trailing slash. */
export function urlTitle(u: URL): string {
  const path = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '')
  return `${u.host}${path}`
}

/** `text` with one final newline, in the body's line-ending style. */
function asBodyText(text: string, crlf: boolean): string {
  const lf = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '') + '\n'
  return crlf ? lf.replace(/\n/g, '\r\n') : lf
}

/** `body` with `text` appended after one blank line (the body's own bytes are kept). */
export function appendToBody(body: string, text: string): string {
  const crlf = body.includes('\r\n')
  const nl = crlf ? '\r\n' : '\n'
  const add = asBodyText(text, crlf)
  if (body.trim() === '') return body + add
  const sep = body.endsWith(nl + nl) ? '' : body.endsWith(nl) ? nl : nl + nl
  return body + sep + add
}

/** The Page type (the basic one named Page), else the first writable type. */
export function pageType(types: readonly TypeDef[]): TypeDef | undefined {
  return (
    types.find((t) => t.basic && t.name.toLowerCase() === 'page') ??
    types.find((t) => t.name.toLowerCase() === 'page') ??
    types.find((t) => !t.readOnlyReason)
  )
}

/** The path of `day`'s daily note, creating the note when there is none. */
export async function ensureDailyNote(day: string = todayYmd()): Promise<string> {
  try {
    return (await api.createDailyNote(day)).path
  } catch (e) {
    if (e instanceof DailyNoteExistsError && e.reason === 'exists' && e.path) return e.path
    throw e
  }
}

/** Append `text` to today's daily note, creating the note when there is none. */
export async function addToDailyNote(text: string, today: string = todayYmd()): Promise<string> {
  return appendToDailyNote(await ensureDailyNote(today), text)
}

/** Append `text` to the daily note at `path` (read from disk, then saved) with the toast. */
export async function appendToDailyNote(path: string, text: string): Promise<string> {
  const detail = await api.object(path)
  await api.saveBody(path, appendToBody(detail.body, text), detail.version)
  showToast(PASTE_TEXT.addedToDailyNote)
  return path
}

/** Create a page (titled `title`, or the default title), write `body` into it and open it. */
export async function createPage(typeId: string, body: string, title?: string): Promise<string> {
  const created = await api.createObject(typeId, title !== undefined ? { title, templateId: 'none' } : { templateId: 'none' })
  if (body.trim()) await api.saveBody(created.path, asBodyText(body, false), created.version)
  openObject(created.path, {}, typeId)
  void invalidateLinkIndex()
  return created.path
}

/** "Create page" from Markdown: the first heading is the title and leaves the body. */
export async function createPageFromMarkdown(typeId: string, text: string): Promise<string> {
  const h = firstHeading(text)
  if (!h) return createPage(typeId, text)
  const lines = text.split(/\r\n?|\n/)
  lines.splice(h.line, 1)
  return createPage(typeId, lines.join('\n').replace(/^\n+/, ''), h.title)
}

/** A page for a pasted URL: one bookmark block; the URL is never fetched. */
export async function createPageFromUrl(typeId: string, u: URL): Promise<string> {
  const href = u.href
  const title = urlTitle(u)
  return createPage(typeId, `<!-- block: bookmark -->\n${bookmarkMarkdown(href, title)}\n`, title)
}

/** Copy every file into `Attachments/`. */
export async function uploadFiles(files: readonly File[]): Promise<string[]> {
  const out: string[] = []
  for (const f of files) out.push((await api.uploadAttachment(f, f.name || 'Pasted file')).path)
  return out
}

export interface PasteAction {
  id: string
  label: string
  icon: string
  /** The muted text on the right ("3 blocks"). */
  preview?: string
  run(): Promise<unknown>
}

/** The clipboard group's offers for `content` (none when denied or empty). */
export function pasteActions(content: ClipboardContent, types: readonly TypeDef[], today?: string): PasteAction[] {
  if (content.kind === 'files') {
    return [{ id: 'paste:upload', label: PASTE_TEXT.upload, icon: 'ph-upload-simple', run: () => uploadFiles(content.files) }]
  }
  if (content.kind !== 'text') return []
  const text = content.text
  const page = pageType(types)
  const out: PasteAction[] = []
  const url = pastedUrl(text)
  if (url && page) {
    out.push({
      id: 'paste:url',
      label: PASTE_TEXT.createHttpLinkEntity(page.name),
      icon: 'ph-link',
      run: () => createPageFromUrl(page.id, url),
    })
  }
  if (!url && page && firstHeading(text)) {
    out.push({ id: 'paste:markdown', label: PASTE_TEXT.createPageFromMd, icon: 'ph-file-text', run: () => createPageFromMarkdown(page.id, text) })
  }
  out.push({
    id: 'paste:dailyNote',
    label: PASTE_TEXT.addToDailyNote,
    icon: 'ph-calendar-plus',
    preview: PASTE_TEXT.blocks(countBlocks(text)),
    run: () => addToDailyNote(text, today),
  })
  if (page) {
    out.push({ id: 'paste:page', label: PASTE_TEXT.createPageWithBlocks, icon: 'ph-file-plus', run: () => createPage(page.id, text) })
  }
  return out
}
