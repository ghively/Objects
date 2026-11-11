import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, DailyNoteExistsError } from '@/api/client'
import { useLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { objectDetail, objectSummary, typeDef } from '@/test/mockApi'
import {
  addToDailyNote,
  appendToBody,
  countBlocks,
  firstHeading,
  pasteActions,
  pastedUrl,
  clipboardReadGranted,
  readClipboard,
  urlTitle,
} from './paste'

const mocked = vi.mocked(api)
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })
const TYPES = [PAGE]

function byId(actions: ReturnType<typeof pasteActions>) {
  return Object.fromEntries(actions.map((a) => [a.id, a]))
}

beforeEach(() => {
  vi.clearAllMocks()
  useTabs.getState().reset()
  usePeek.getState().close()
  useLinkIndex.setState({ types: TYPES, objects: [], loaded: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reading the clipboard', () => {
  test('text through read()', async () => {
    const clip = {
      read: async () => [{ types: ['text/plain'], getType: async () => new Blob(['hello']) }],
    } as unknown as Clipboard
    expect(await readClipboard(clip)).toEqual({ kind: 'text', text: 'hello' })
  })

  test('an image becomes a file', async () => {
    const clip = {
      read: async () => [{ types: ['image/png'], getType: async () => new Blob(['x'], { type: 'image/png' }) }],
    } as unknown as Clipboard
    const c = await readClipboard(clip)
    expect(c.kind).toBe('files')
    if (c.kind === 'files') expect(c.files[0].name).toBe('Pasted 1.png')
  })

  test('readText fallback, empty text, and refusal', async () => {
    expect(await readClipboard({ readText: async () => 'hi' } as unknown as Clipboard)).toEqual({ kind: 'text', text: 'hi' })
    expect(await readClipboard({ readText: async () => '  ' } as unknown as Clipboard)).toEqual({ kind: 'empty' })
    const denied = { read: async () => Promise.reject(new DOMException('no', 'NotAllowedError')) } as unknown as Clipboard
    expect(await readClipboard(denied)).toEqual({ kind: 'denied' })
    expect(await readClipboard(undefined)).toEqual({ kind: 'denied' })
  })
})

describe('the clipboard-read permission', () => {
  test('granted only when the Permissions API says granted; unsupported or failing is not granted', async () => {
    const perms = (state: PermissionState) => ({ query: async () => ({ state }) }) as unknown as Permissions
    expect(await clipboardReadGranted(perms('granted'))).toBe(true)
    expect(await clipboardReadGranted(perms('prompt'))).toBe(false)
    expect(await clipboardReadGranted(perms('denied'))).toBe(false)
    expect(await clipboardReadGranted(undefined)).toBe(false)
    const throws = { query: async () => Promise.reject(new TypeError('clipboard-read is not a permission name')) } as unknown as Permissions
    expect(await clipboardReadGranted(throws)).toBe(false)
  })
})

describe('classifying', () => {
  test('urls, headings and block counts', () => {
    expect(pastedUrl('https://example.com/a/b/')?.host).toBe('example.com')
    expect(pastedUrl('see https://example.com')).toBeNull()
    expect(pastedUrl('ftp://example.com')).toBeNull()
    expect(urlTitle(new URL('https://example.com/docs/'))).toBe('example.com/docs')
    expect(urlTitle(new URL('https://example.com/'))).toBe('example.com')
    expect(firstHeading('intro\n\n## Plan\n\ntext')).toEqual({ title: 'Plan', line: 2 })
    expect(firstHeading('```\n# not\n```\ntext')).toBeNull()
    expect(countBlocks('one')).toBe(1)
    expect(countBlocks('one\n\ntwo\n\n- a\n- b\n')).toBe(3)
  })

  test('appending keeps the body bytes and its line endings', () => {
    expect(appendToBody('', 'x')).toBe('x\n')
    expect(appendToBody('a\n', 'x')).toBe('a\n\nx\n')
    expect(appendToBody('a', 'x\ny')).toBe('a\n\nx\ny\n')
    expect(appendToBody('a\n\n', 'x')).toBe('a\n\nx\n')
    expect(appendToBody('a\r\n', 'x\ny')).toBe('a\r\n\r\nx\r\ny\r\n')
  })

  test('offers by content kind', () => {
    expect(pasteActions({ kind: 'text', text: 'hello' }, TYPES).map((a) => a.label)).toEqual([
      "Paste into today's daily note",
      'Make a new note from the clipboard',
    ])
    expect(pasteActions({ kind: 'text', text: '# T\n\nbody' }, TYPES).map((a) => a.label)).toEqual([
      'Create note',
      "Paste into today's daily note",
      'Make a new note from the clipboard',
    ])
    expect(pasteActions({ kind: 'text', text: 'https://example.com' }, TYPES)[0].label).toBe('Create Note')
    expect(pasteActions({ kind: 'files', files: [new File(['x'], 'a.png')] }, TYPES).map((a) => a.label)).toEqual(['Upload'])
    expect(byId(pasteActions({ kind: 'text', text: 'a\n\nb' }, TYPES))['paste:dailyNote'].preview).toBe('2 blocks')
    expect(byId(pasteActions({ kind: 'text', text: 'a' }, TYPES))['paste:dailyNote'].preview).toBe('1 block')
  })
})

describe('running the offers', () => {
  test('add to daily note appends and creates', async () => {
    // No note yet: it is created, then the text is appended to its (template) body.
    mocked.createDailyNote.mockResolvedValueOnce({ path: 'DailyNotes/2026-10-27.md', version: 'v1', typeIds: [] })
    mocked.object.mockResolvedValueOnce(
      objectDetail({ summary: objectSummary({ path: 'DailyNotes/2026-10-27.md' }), body: '', version: 'v1' }),
    )
    await addToDailyNote('Buy milk', '2026-10-27')
    expect(mocked.createDailyNote).toHaveBeenCalledWith('2026-10-27')
    expect(mocked.saveBody).toHaveBeenCalledWith('DailyNotes/2026-10-27.md', 'Buy milk\n', 'v1')
    expect(document.querySelector('[data-editor-toasts]')?.textContent).toContain('Sent to the daily note')

    // The note exists: append after its body.
    mocked.saveBody.mockClear()
    mocked.createDailyNote.mockRejectedValueOnce(new DailyNoteExistsError('exists', 'DailyNotes/2026-10-27.md', 'exists'))
    mocked.object.mockResolvedValueOnce(
      objectDetail({ summary: objectSummary({ path: 'DailyNotes/2026-10-27.md' }), body: 'Morning\n', version: 'v7' }),
    )
    await addToDailyNote('Buy milk', '2026-10-27')
    expect(mocked.saveBody).toHaveBeenCalledWith('DailyNotes/2026-10-27.md', 'Morning\n\nBuy milk\n', 'v7')

    // Another file holds the name: nothing is written.
    mocked.saveBody.mockClear()
    mocked.createDailyNote.mockRejectedValueOnce(new DailyNoteExistsError('taken', 'Pages/2026-10-27.md', 'nameTaken'))
    await expect(addToDailyNote('x', '2026-10-27')).rejects.toBeInstanceOf(DailyNoteExistsError)
    expect(mocked.saveBody).not.toHaveBeenCalled()
  })

  test('create page from markdown takes the first heading', async () => {
    mocked.createObject.mockResolvedValueOnce({ path: 'Pages/Plan.md', version: 'v1' })
    await byId(pasteActions({ kind: 'text', text: '# Plan\n\n- one\n- two\n' }, TYPES))['paste:markdown'].run()
    // The text goes in the creating write (M14: a creation rule can't make its save a 409).
    expect(mocked.createObject).toHaveBeenCalledWith('page', { title: 'Plan', templateId: 'none', body: '- one\n- two\n' })
    expect(mocked.saveBody).not.toHaveBeenCalled()
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Pages/Plan.md' })
  })

  test('create new page with content keeps the whole text', async () => {
    mocked.createObject.mockResolvedValueOnce({ path: 'Pages/Untitled.md', version: 'v1' })
    await byId(pasteActions({ kind: 'text', text: 'alpha\n\nbeta' }, TYPES))['paste:page'].run()
    expect(mocked.createObject).toHaveBeenCalledWith('page', { templateId: 'none', body: 'alpha\n\nbeta\n' })
    expect(mocked.saveBody).not.toHaveBeenCalled()
  })

  test('upload creates attachments', async () => {
    const files = [new File(['a'], 'one.png', { type: 'image/png' }), new File(['b'], 'two.pdf')]
    await byId(pasteActions({ kind: 'files', files }, TYPES))['paste:upload'].run()
    expect(mocked.uploadAttachment).toHaveBeenCalledTimes(2)
    expect(mocked.uploadAttachment.mock.calls.map((c) => c[1])).toEqual(['one.png', 'two.pdf'])
    expect(mocked.createObject).not.toHaveBeenCalled()
  })

  test('pasted url creates a page without fetching', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    mocked.createObject.mockResolvedValueOnce({ path: 'Pages/example.com_docs.md', version: 'v1' })
    await byId(pasteActions({ kind: 'text', text: 'https://example.com/docs' }, TYPES))['paste:url'].run()
    expect(mocked.createObject).toHaveBeenCalledWith('page', {
      title: 'example.com/docs',
      templateId: 'none',
      body: '<!-- block: bookmark -->\n[example.com/docs](https://example.com/docs)\n',
    })
    expect(mocked.saveBody).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('clipboard denied offers nothing', () => {
    expect(pasteActions({ kind: 'denied' }, TYPES)).toEqual([])
    expect(pasteActions({ kind: 'empty' }, TYPES)).toEqual([])
  })
})
