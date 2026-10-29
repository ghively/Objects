import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ObjectDetail, SpaceInfo, TypeDef, UpdateResult } from '@/api/types'
import { objectDetail, objectSummary, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/find/FindBar', () => ({ FindBar: () => null }))
vi.mock('@/references/ReferencesSection', () => ({ ReferencesSection: () => null }))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { RESERVED_KEYS } from '@/properties/typeEdits'
import { ObjectView, patchSummary } from './ObjectView'

const mocked = vi.mocked(api)
const PATH = 'Pages/Notes.md'
let onDisk: ObjectDetail

function setup(type: TypeDef, frontmatter: Record<string, unknown> = {}, coverImage: string | null = null) {
  onDisk = objectDetail({
    summary: objectSummary({ path: PATH, type: type.id, title: 'Notes', coverImage }),
    frontmatter: { type: type.name, title: 'Notes', ...(coverImage ? { coverImage } : {}), ...frontmatter },
    body: 'Hello.\n',
    version: 'v1',
  })
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [type] } satisfies SpaceInfo)
  mocked.objects.mockResolvedValue([onDisk.summary])
  mocked.object.mockImplementation(async () => onDisk)
}

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.resolve.mockResolvedValue(null)
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.fileUrl.mockImplementation((p: string) => `/api/file?path=${encodeURIComponent(p)}`)
  mocked.images.mockResolvedValue([{ path: 'Attachments/a.png' }, { path: 'Attachments/b.png' }])
  mocked.updateProperties.mockImplementation(
    async (_p: string, updates: Record<string, unknown>): Promise<UpdateResult> => ({
      version: 'v2',
      frontmatter: { ...updates },
      links: {},
      synced: [],
      skipped: [],
    }),
  )
})

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More' }))
  return screen.findByRole('menu')
}

function wideAttr(container: HTMLElement) {
  return (container.querySelector('[data-page-content]') as HTMLElement).dataset.wide
}

describe('ObjectView per-object layout (M9)', () => {
  test('test object value overrides type wide layout', async () => {
    const user = userEvent.setup()
    setup(typeDef({ id: 'page', name: 'Page', wideLayoutMode: true }), { wideLayoutMode: false })
    const a = render(<ObjectView path={PATH} mode="page" />)
    await screen.findByText('Hello.')
    expect(wideAttr(a.container)).toBe('false')
    let menu = await openMenu(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Wide layout' }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith(PATH, { wideLayoutMode: true }, 'v1', undefined))
    await waitFor(() => expect(wideAttr(a.container)).toBe('true'))
    a.unmount()

    setup(typeDef({ id: 'page', name: 'Page', wideLayoutMode: false }), { wideLayoutMode: true })
    resetLinkIndex()
    const b = render(<ObjectView path={PATH} mode="page" />)
    await screen.findByText('Hello.')
    expect(wideAttr(b.container)).toBe('true')
    menu = await openMenu(user)
    expect(within(menu).getByRole('menuitem', { name: 'Normal layout' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Wide layout' })).toBeNull()
  })

  test('test wide layout item hidden for index card and whiteboard', async () => {
    const user = userEvent.setup()
    setup(typeDef({ id: 'card', name: 'Card', viewDesign: 'indexCard' }))
    const a = render(<ObjectView path={PATH} mode="page" />)
    await screen.findByText('Hello.')
    let menu = await openMenu(user)
    expect(within(menu).queryByRole('menuitem', { name: /Wide layout|Normal layout/ })).toBeNull()
    await user.keyboard('{Escape}')
    a.unmount()

    setup(typeDef({ id: 'whiteboard', name: 'Whiteboard', basic: true }))
    resetLinkIndex()
    render(<ObjectView path={PATH} mode="page" />)
    await screen.findByText('Hello.')
    menu = await openMenu(user)
    expect(within(menu).queryByRole('menuitem', { name: /Wide layout|Normal layout/ })).toBeNull()
  })

  test('test toggle wide cover from type default', async () => {
    const user = userEvent.setup()
    setup(typeDef({ id: 'page', name: 'Page', wideCoverImage: false }), {}, 'Attachments/a.png')
    const { container } = render(<ObjectView path={PATH} mode="page" />)
    await screen.findByText('Hello.')
    const cover = () => container.querySelector('[data-cover-image]') as HTMLElement
    expect(cover().dataset.wide).toBe('false')
    // No value: the opposite of the type's setting.
    await user.click(within(cover()).getByRole('button', { name: 'Toggle wide cover image' }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith(PATH, { wideCoverImage: true }, 'v1', undefined))
    await waitFor(() => expect(cover().dataset.wide).toBe('true'))
    // A value: flipped.
    await user.click(within(cover()).getByRole('button', { name: 'Toggle wide cover image' }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenLastCalledWith(PATH, { wideCoverImage: false }, 'v2', undefined))
  })

  test('test changing cover clears offset', async () => {
    const user = userEvent.setup()
    setup(typeDef({ id: 'page', name: 'Page' }), { coverImageOffset: 30 }, 'Attachments/a.png')
    const { container } = render(<ObjectView path={PATH} mode="page" />)
    await screen.findByText('Hello.')
    const cover = container.querySelector('[data-cover-image]') as HTMLElement
    expect((cover.querySelector('img') as HTMLImageElement).style.objectPosition).toBe('0% 30%')
    await user.click(within(cover).getByRole('button', { name: 'Pick cover image' }))
    await user.click(await screen.findByRole('button', { name: 'Attachments/b.png' }))
    await waitFor(() =>
      expect(mocked.updateProperties).toHaveBeenCalledWith(
        PATH,
        { coverImage: 'Attachments/b.png', coverImageOffset: null },
        'v1',
        undefined,
      ),
    )
  })

  test('test reposition save writes the offset', async () => {
    const user = userEvent.setup()
    setup(typeDef({ id: 'page', name: 'Page' }), {}, 'Attachments/a.png')
    const { container } = render(<ObjectView path={PATH} mode="page" />)
    await screen.findByText('Hello.')
    const cover = container.querySelector('[data-cover-image]') as HTMLElement
    await user.click(within(cover).getByRole('button', { name: 'Reposition cover image' }))
    // Unmoved: nothing to write.
    await user.click(within(cover).getByRole('button', { name: 'Save' }))
    expect(mocked.updateProperties).not.toHaveBeenCalled()

    await user.click(within(cover).getByRole('button', { name: 'Reposition cover image' }))
    const img = cover.querySelector('img') as HTMLImageElement
    img.getBoundingClientRect = () => ({ width: 800, height: 200, top: 0, left: 0, right: 800, bottom: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    fireEvent.pointerDown(img, { button: 0, clientY: 100 })
    fireEvent.pointerMove(window, { clientY: 140 })
    fireEvent.pointerUp(window, { clientY: 140 })
    await user.click(within(cover).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith(PATH, { coverImageOffset: 30 }, 'v1', undefined))
  })

  test('test layout keys not shown as properties', async () => {
    for (const k of ['wideLayoutMode', 'wideCoverImage', 'coverImageOffset', 'defaultPageViewId']) expect(RESERVED_KEYS.has(k)).toBe(true)
    const fm = { wideLayoutMode: true, wideCoverImage: false, coverImageOffset: 40, defaultPageViewId: 'pv1' }
    // A type without definitions (frontmatter keys become rows) and one with (external keys).
    for (const type of [
      typeDef({ id: 'page', name: 'Page' }),
      typeDef({ id: 'page', name: 'Page', propertyDefinitions: [propertyDef({ id: 'rating', name: 'Rating', type: 'number' })] }),
    ]) {
      setup(type, fm)
      resetLinkIndex()
      const r = render(<ObjectView path={PATH} mode="page" />)
      await screen.findByText('Hello.')
      for (const k of Object.keys(fm)) expect(screen.queryByText(k)).toBeNull()
      r.unmount()
    }
  })
})

describe('patchSummary', () => {
  test('a property write refreshes "Last updated" from the written frontmatter', () => {
    const before = objectSummary({ path: 'Pages/A.md', lastUpdated: '2026-01-01T00:00:00Z' })
    const after = patchSummary(before, { wideLayoutMode: true, lastUpdated: '2026-10-28T09:30:00Z' })
    expect(after.lastUpdated).toBe('2026-10-28T09:30:00Z')
    // A write that didn't stamp it (no key) keeps the old value.
    expect(patchSummary(before, { wideLayoutMode: true }).lastUpdated).toBe('2026-01-01T00:00:00Z')
  })
})
