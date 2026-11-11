// Audit 2026-11-01 P3 and F5: start-up fetches the space once and the settings alongside it; one
// `changed` event refreshes that object's summary only (one /api/rows call, no shell re-render),
// and the whole list is fetched again only when the set of objects or a type changes.
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, Row, SpaceInfo } from '@/api/types'
import { objectDetail, objectSummary, typeDef } from '@/test/mockApi'

let sidebarRenders = 0
let objectPageRenders = 0

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/shell/Sidebar', async (orig) => {
  const m = await orig<typeof import('@/shell/Sidebar')>()
  return {
    ...m,
    Sidebar: (p: Parameters<typeof m.Sidebar>[0]) => {
      sidebarRenders++
      return m.Sidebar(p)
    },
  }
})
vi.mock('@/object/ObjectPage', () => ({
  ObjectPage: ({ path }: { path: string }) => {
    objectPageRenders++
    return <div data-testid="object-page">{path}</div>
  },
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { useSettings } from '@/settings/useSettings'
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { resetPinned } from '@/shell/usePinned'
import App from './App'

const mocked = vi.mocked(api)
const listeners = new Set<(e: ChangeEvent) => void>()
const emit = (e: ChangeEvent) => {
  for (const cb of [...listeners]) cb(e)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true, revision: 'r1' })
const PROJECT = typeDef({ id: 'project', name: 'Project', pluralName: 'Projects', revision: 'r1' })
const OBJECTS = Array.from({ length: 300 }, (_, i) => objectSummary({ path: `Projects/P${i}.md`, type: 'project', title: `P${i}`, id: `id${i}` }))
const asRow = (path: string, title: string): Row => ({ summary: objectSummary({ path, type: 'project', title, id: path }), version: 'v9', values: {}, links: {}, preview: '' })

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  resetPinned()
  resetSpaceInfo()
  useSettings.setState({ loaded: false })
  listeners.clear()
  sidebarRenders = objectPageRenders = 0
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE, PROJECT] } as SpaceInfo)
  mocked.objects.mockResolvedValue(OBJECTS)
  mocked.rows.mockImplementation(async (scope) => (scope?.paths ?? []).map((p: string) => asRow(p, `${p} v9`)))
  mocked.object.mockImplementation(async (path: string) => objectDetail({ summary: objectSummary({ path, type: 'project' }), version: 'v1' }))
  mocked.onChange.mockImplementation((cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  })
})

describe('start-up (F5)', () => {
  test('one GET /api/space, and the settings are not made to wait for it', async () => {
    let resolveSpace: (s: SpaceInfo) => void = () => undefined
    mocked.space.mockImplementationOnce(() => new Promise<SpaceInfo>((r) => (resolveSpace = r)))
    render(<App />)
    await sleep(20)
    expect(mocked.settings).toHaveBeenCalledTimes(1)
    resolveSpace({ name: 's', root: '/s', types: [PAGE, PROJECT] } as SpaceInfo)
    await screen.findByRole('button', { name: 'New' })
    await waitFor(() => expect(mocked.objects).toHaveBeenCalled())
    await sleep(50)
    expect(mocked.space).toHaveBeenCalledTimes(1)
    expect(mocked.settings).toHaveBeenCalledTimes(1)
    expect(mocked.objects).toHaveBeenCalledTimes(1)
  })
})

describe('change events (P3)', () => {
  test('a body-only change elsewhere refreshes that summary alone and re-renders no shell part', async () => {
    useTabs.getState().open({ kind: 'object', path: 'Projects/P1.md' })
    render(<App />)
    await screen.findByTestId('object-page')
    await waitFor(() => expect(mocked.objects).toHaveBeenCalled())
    await waitFor(() => expect(useLinkIndex.getState().loaded).toBe(true))
    await sleep(100)
    const before = { sidebarRenders, objectPageRenders, objects: mocked.objects.mock.calls.length, space: mocked.space.mock.calls.length }
    const wasB = useLinkIndex.getState().objects[2]
    await act(async () => {
      emit({ kind: 'changed', path: 'Projects/P250.md', version: 'v9', origin: 'other-window' })
      await sleep(250)
    })
    expect(mocked.rows).toHaveBeenCalledWith({ paths: ['Projects/P250.md'], preview: false })
    expect(mocked.objects.mock.calls.length).toBe(before.objects)
    expect(mocked.space.mock.calls.length).toBe(before.space)
    expect(useLinkIndex.getState().objects.find((o) => o.path === 'Projects/P250.md')?.title).toBe('Projects/P250.md v9')
    expect(useLinkIndex.getState().objects[2]).toBe(wasB)
    expect(useLinkIndex.getState().loaded).toBe(true)
    expect(sidebarRenders).toBe(before.sidebarRenders)
    expect(objectPageRenders).toBe(before.objectPageRenders)
  })

  test('ten body saves = ten row fetches and no list refetch; a created or types event refetches the list', async () => {
    // The (stubbed) object page: a type page's view refreshes the changed row on its own account too.
    useTabs.getState().open({ kind: 'object', path: 'Projects/P1.md' })
    render(<App />)
    await screen.findByTestId('object-page')
    await waitFor(() => expect(useLinkIndex.getState().loaded).toBe(true))
    await sleep(100)
    const objects = mocked.objects.mock.calls.length
    const rows = mocked.rows.mock.calls.length
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        emit({ kind: 'changed', path: 'Projects/P7.md', version: `v${i}`, origin: 'other' })
        await sleep(200)
      })
    }
    expect(mocked.objects.mock.calls.length).toBe(objects)
    expect(mocked.rows.mock.calls.length).toBe(rows + 10)
    // A burst with a `created` in it: one full fetch, no row fetch.
    await act(async () => {
      emit({ kind: 'changed', path: 'Projects/P7.md', version: 'v10', origin: 'other' })
      emit({ kind: 'created', path: 'Projects/New.md', version: 'v1', origin: 'other' })
      await sleep(250)
    })
    expect(mocked.objects.mock.calls.length).toBe(objects + 1)
    expect(mocked.rows.mock.calls.length).toBe(rows + 10)
    // `types` with path `*` (the SSE resync) too; `ui` is not the index's business.
    await act(async () => {
      emit({ kind: 'types', path: '*', version: null, origin: null })
      emit({ kind: 'ui', path: '*', version: null, origin: null })
      await sleep(250)
    })
    expect(mocked.objects.mock.calls.length).toBe(objects + 2)
    expect(mocked.space.mock.calls.length).toBe(3) // start-up and the two full fetches
  })
})

describe('kept unsaved text (end review of the second audit fix pass)', () => {
  test('follows its object when it is renamed elsewhere', async () => {
    const { keepUnsaved, keptUnsaved, resetUnsaved } = await import('@/editor/unsaved')
    render(<App />)
    await screen.findByRole('button', { name: 'New' })
    resetUnsaved()
    keepUnsaved('Projects/P1.md', 'mine\n', 'id1')
    act(() => emit({ kind: 'renamed', path: 'Projects/Renamed.md', oldPath: 'Projects/P1.md', version: 'v2', origin: 'other-window' }))
    expect(keptUnsaved('Projects/P1.md')).toBeNull()
    expect(keptUnsaved('Projects/Renamed.md', 'id1')).toBe('mine\n')
    resetUnsaved()
  })

  // M32 fix pass, F2: a window that closed with its save on the way never cleared its entry.
  test('text the file already holds is forgotten when the space opens; text it does not hold stays', async () => {
    const { keptUnsaved, resetUnsaved } = await import('@/editor/unsaved')
    const { objectDetail, objectSummary } = await import('@/test/mockApi')
    const left = (path: string, body: string) => localStorage.setItem(`object.unsaved:/s\n${path}`, JSON.stringify({ body, id: null }))
    left('Projects/Landed.md', 'saved after the window had gone\n')
    left('Projects/Cut.md', 'words the close cut off\n')
    const disk: Record<string, string> = { 'Projects/Landed.md': 'saved after the window had gone\n', 'Projects/Cut.md': 'before\n' }
    mocked.object.mockImplementation(async (path: string) => {
      if (!(path in disk)) throw new Error('Not found')
      return objectDetail({ summary: objectSummary({ path }), body: disk[path], version: 'v1' })
    })
    render(<App />)
    await screen.findByRole('button', { name: 'New' })
    await waitFor(() => expect(keptUnsaved('Projects/Landed.md')).toBeNull())
    expect(keptUnsaved('Projects/Cut.md')).toBe('words the close cut off\n')
    resetUnsaved()
  })
})
