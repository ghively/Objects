// M9 Task 1: the client contract for duplicate, export and workspaceOrder.
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, ObjectFrontmatterLayout, UiState } from './types'
import { api, type UiPatch } from './client'

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

type Call = [string, RequestInit | undefined]
const urlOf = (f: ReturnType<typeof vi.fn>, i = 0) => (f.mock.calls[i] as unknown as Call)[0]
const initOf = (f: ReturnType<typeof vi.fn>, i = 0) => (f.mock.calls[i] as unknown as Call)[1]
const bodyOf = (f: ReturnType<typeof vi.fn>, i = 0) => JSON.parse(String(initOf(f, i)?.body)) as Record<string, unknown>

afterEach(() => vi.unstubAllGlobals())

describe('m9 client contract', () => {
  test('test duplicateObject posts path', async () => {
    const summary = { path: 'Pages/A (Copy).md', title: 'A (Copy)' }
    const f = respond(201, { path: 'Pages/A (Copy).md', version: 'v1', summary })
    vi.stubGlobal('fetch', f)
    const seen: ChangeEvent[] = []
    const off = api.onChange((e) => seen.push(e))
    try {
      await expect(api.duplicateObject('Pages/A.md')).resolves.toMatchObject({ path: 'Pages/A (Copy).md', version: 'v1' })
      await new Promise((r) => setTimeout(r, 0))
    } finally {
      off()
    }
    expect(urlOf(f)).toBe('/api/object/duplicate')
    expect(initOf(f)?.method).toBe('POST')
    expect(bodyOf(f)).toMatchObject({ path: 'Pages/A.md' })
    expect(seen.some((e) => e.kind === 'created' && e.path === 'Pages/A (Copy).md')).toBe(true)
  })

  test('test exportObjectUrl builds a same-origin url with media flag', () => {
    const plain = api.exportObjectUrl('Pages/A b.md', { media: false })
    const zip = api.exportObjectUrl('Pages/A b.md', { media: true })
    expect(plain).toBe('/api/object/export?path=Pages%2FA+b.md&media=0')
    expect(zip).toBe('/api/object/export?path=Pages%2FA+b.md&media=1')
    expect(plain).not.toMatch(/http/)
  })

  test('test patchUi accepts workspaceOrder', () => {
    const patch: UiPatch = { workspaceOrder: ['objects', 'pinned', 's1'] }
    const ui = { pinned: [], sections: [], allNotesLayout: 'list', workspaceOrder: ['pinned'] } satisfies UiState
    const layout: ObjectFrontmatterLayout = { wideLayoutMode: true, wideCoverImage: null, coverImageOffset: 30 }
    expect(patch.workspaceOrder).toHaveLength(3)
    expect(ui.workspaceOrder).toEqual(['pinned'])
    expect(layout.coverImageOffset).toBe(30)
  })
})
