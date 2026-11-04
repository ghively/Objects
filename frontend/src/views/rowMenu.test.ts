// M9 Task 17: the common row menu (a data view's context menu).
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { objectSummary, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { usePeek, useTabs } from '@/nav/tabs'
import { commonRowMenu, ROW_MENU_TEXT, type RowMenuCtx } from './rowMenu'

const mocked = vi.mocked(api)
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages' })
const BOOK = typeDef({ id: 'book', name: 'Book', pluralName: 'Books' })
const DAILY = typeDef({ id: 'dailynote', name: 'DailyNote', pluralName: 'DailyNotes', basic: true })
const BOARD = typeDef({ id: 'whiteboard', name: 'Whiteboard', pluralName: 'Whiteboards', basic: true })
const TYPES = [PAGE, BOOK, DAILY, BOARD]

const mk = (over: Partial<Parameters<typeof objectSummary>[0]> = {}) =>
  row({ summary: objectSummary({ path: 'Pages/Alpha.md', type: 'page', title: 'Alpha', ...over }), version: 'v1' })

function ctx(over: Partial<RowMenuCtx> = {}): RowMenuCtx {
  return { types: TYPES, selectMultiple: vi.fn(), changeType: vi.fn(), requestDelete: vi.fn(), ...over }
}

beforeEach(() => {
  useTabs.getState().reset()
  usePeek.getState().close()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
})

describe('commonRowMenu', () => {
  test('test type page row menu items and order', () => {
    const items = commonRowMenu(mk(), ctx())
    expect(items.map((i) => i.label)).toEqual([
      'Select multiple',
      'Open in side panel',
      'Open in new tab',
      'Change type',
      'Copy object reference',
      'Duplicate',
      'Delete Object',
    ])
    expect(items.find((i) => i.key === 'delete')?.destructive).toBe(true)
    // "Change type" lists the other types.
    expect(items.find((i) => i.key === 'changeType')?.children?.map((c) => c.label)).toEqual(['Book', 'DailyNote', 'Whiteboard'])
  })

  test('test duplicate hidden for daily note, template, whiteboard and read-only', () => {
    const has = (r: ReturnType<typeof mk>) => commonRowMenu(r, ctx()).some((i) => i.label === ROW_MENU_TEXT.duplicate)
    expect(has(mk())).toBe(true)
    expect(has(mk({ type: 'dailynote' }))).toBe(false)
    expect(has(mk({ type: 'whiteboard' }))).toBe(false)
    expect(has(mk({ template: 'Weekly' }))).toBe(false)
    expect(has(mk({ readOnly: true }))).toBe(false)
  })

  test('test read-only rows offer no change type or delete', () => {
    const labels = commonRowMenu(mk({ readOnly: true }), ctx()).map((i) => i.label)
    expect(labels).not.toContain('Change type')
    expect(labels).not.toContain('Delete Object')
  })

  test('test actions open, select, change type and delete through the context', () => {
    const c = ctx()
    const r = mk()
    const items = commonRowMenu(r, c)
    const pick = (key: string) => items.find((i) => i.key === key)!
    pick('selectMultiple').onSelect()
    expect(c.selectMultiple).toHaveBeenCalledWith(r)
    pick('openInTab').onSelect()
    expect(useTabs.getState().tabs).toHaveLength(1)
    pick('openInSidepanel').onSelect()
    pick('changeType').children![0].onSelect()
    expect(c.changeType).toHaveBeenCalledWith(r, BOOK)
    pick('delete').onSelect()
    expect(c.requestDelete).toHaveBeenCalledWith(r)
  })

  test('test duplicate posts and peeks the copy', async () => {
    mocked.duplicateObject.mockResolvedValue({ path: 'Pages/Alpha (Copy).md', version: 'v2', summary: objectSummary({ path: 'Pages/Alpha (Copy).md' }) })
    commonRowMenu(mk(), ctx()).find((i) => i.key === 'duplicate')!.onSelect()
    await vi.waitFor(() => expect(usePeek.getState().path).toBe('Pages/Alpha (Copy).md'))
    expect(mocked.duplicateObject).toHaveBeenCalledWith('Pages/Alpha.md')
  })

  test('test copy object reference writes the wikilink and toasts', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    commonRowMenu(mk(), ctx()).find((i) => i.key === 'copyReference')!.onSelect()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('[[Alpha]]'))
    await vi.waitFor(() => expect(document.body.textContent).toContain('Link to object copied'))
  })
})
