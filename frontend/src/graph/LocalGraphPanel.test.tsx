import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { GraphData, GraphNode } from '@/api/types'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('sigma', async () => (await import('./testSigma')).sigmaModule())
vi.mock('graphology-layout-forceatlas2/worker', async () => (await import('./testSigma')).fa2Module())

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { resetPinned, useUiStore } from '@/shell/usePinned'
import { resetOpenAsFullPage, setOpenAsFullPage } from '@/test/fullPage'
import { graphData, typeDef } from '@/test/mockApi'
import { HOPS_KEY, LocalGraphPanel } from './LocalGraphPanel'
import { latestPaths, sigmaInstances } from './testSigma'
import { resetGraphData } from './useGraphData'
import { flushGraphUi, resetGraphUi } from './useGraphUi'

const mocked = vi.mocked(api)

function node(path: string, partial: Partial<GraphNode> = {}): GraphNode {
  return { path, title: path.replace(/\.md$/, ''), type: 'page', icon: null, degree: 1, tag: false, daily: false, done: false, ...partial }
}

// Ada – Charles – Engine – Note chain; Done (a done task) links to Ada; Topic is a tag on Lone.
const DATA: GraphData = graphData({
  nodes: [
    node('Ada.md'),
    node('Charles.md'),
    node('Engine.md'),
    node('Note.md'),
    node('Done.md', { type: 'task', done: true }),
    node('Topic.md', { type: 'tag', tag: true }),
    node('Lone.md'),
  ],
  links: [0, 1, 1, 2, 2, 3, 0, 4],
  tagged: [6, 5],
})

async function sigmaReady() {
  await screen.findByTestId('graph-canvas')
  await waitFor(() => expect(sigmaInstances.length).toBeGreaterThan(0))
  return sigmaInstances[sigmaInstances.length - 1]
}

function setUi(graph = {}) {
  useUiStore.setState({ ui: { pinned: [], sections: [], allNotesLayout: 'list', graph }, revision: 'r0', loaded: true })
}

beforeEach(() => {
  resetGraphData()
  resetGraphUi()
  resetPinned()
  resetLinkIndex()
  usePeek.getState().close()
  useTabs.setState({ tabs: [], activeId: null })
  resetOpenAsFullPage()
  localStorage.clear()
  sigmaInstances.length = 0
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  mocked.graph.mockImplementation(async () => DATA)
  useLinkIndex.setState({
    types: [typeDef({ id: 'page', name: 'Page' }), typeDef({ id: 'task', name: 'Task' }), typeDef({ id: 'tag', name: 'Tag' })],
    objects: [],
    loaded: true,
  })
  setUi()
})

describe('LocalGraphPanel', () => {
  test('local graph shows the centre and its one-hop neighbours; show more adds the second hop and remembers it', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<LocalGraphPanel path="Charles.md" />)
    await sigmaReady()
    await waitFor(() => expect(latestPaths().sort()).toEqual(['Ada.md', 'Charles.md', 'Engine.md']))
    expect(screen.getByTestId('local-graph-hops')).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: 'Show more' }))
    await waitFor(() => expect(latestPaths().sort()).toEqual(['Ada.md', 'Charles.md', 'Engine.md', 'Note.md']))
    expect(screen.getByTestId('local-graph-hops')).toHaveTextContent('2')
    expect(localStorage.getItem(HOPS_KEY)).toBe('2')
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-disabled', 'false')
    unmount()

    // Remembered on the next mount.
    render(<LocalGraphPanel path="Charles.md" />)
    await sigmaReady()
    await waitFor(() => expect(latestPaths()).toHaveLength(4))
    expect(screen.getByTestId('local-graph-hops')).toHaveTextContent('2')
    await user.click(screen.getByRole('button', { name: 'Show less' }))
    await waitFor(() => expect(latestPaths()).toHaveLength(3))
    expect(localStorage.getItem(HOPS_KEY)).toBe('1')
  })

  test('maximum distance runs 1–5 one step at a time, default 1 (hops)', async () => {
    const user = userEvent.setup()
    render(<LocalGraphPanel path="Charles.md" />)
    await sigmaReady()
    const hops = screen.getByTestId('local-graph-hops')
    const less = screen.getByRole('button', { name: 'Show less' })
    const more = screen.getByRole('button', { name: 'Show more' })
    expect(hops).toHaveTextContent('1')
    expect(less).toHaveAttribute('aria-disabled', 'true')
    for (let n = 2; n <= 5; n++) {
      await user.click(more)
      expect(hops).toHaveTextContent(String(n))
    }
    expect(more).toHaveAttribute('aria-disabled', 'true')
    expect(localStorage.getItem(HOPS_KEY)).toBe('5')
    await user.click(less)
    expect(hops).toHaveTextContent('4')
    expect(more).toHaveAttribute('aria-disabled', 'false')
  })

  test('an out-of-range remembered distance falls back to 1', async () => {
    localStorage.setItem(HOPS_KEY, '9')
    render(<LocalGraphPanel path="Charles.md" />)
    await sigmaReady()
    expect(screen.getByTestId('local-graph-hops')).toHaveTextContent('1')
  })

  test('centre stays visible under filters that would hide it', async () => {
    // Done.md is a completed task (hidden by default) and its type is excluded too.
    setUi({ excludeTypeIds: ['task'] })
    render(<LocalGraphPanel path="Done.md" />)
    const sigma = await sigmaReady()
    await waitFor(() => expect(latestPaths().sort()).toEqual(['Ada.md', 'Done.md']))
    // The centre is highlighted and always labelled.
    const reducer = sigma.settings.nodeReducer as (k: string, a: Record<string, unknown>) => Record<string, unknown>
    const centre = reducer('4', { path: 'Done.md', label: 'Done', size: 3, color: '#000', x: 0, y: 0 })
    expect(centre).toMatchObject({ highlighted: true, forceLabel: true })
    const other = reducer('0', { path: 'Ada.md', label: 'Ada', size: 3, color: '#000', x: 0, y: 0 })
    expect(other.highlighted).toBeUndefined()
    expect(screen.queryByText('Nothing to show')).toBeNull()
  })

  test('tag centre with tags network includes tagged objects', async () => {
    const user = userEvent.setup()
    render(<LocalGraphPanel path="Topic.md" />)
    await sigmaReady()
    await waitFor(() => expect(latestPaths()).toEqual(['Topic.md']))

    await user.click(screen.getByRole('button', { name: 'Customize' }))
    await user.click(await screen.findByRole('switch', { name: 'Show tags network' }))
    expect(useUiStore.getState().ui.graph).toEqual({ showTagsNetwork: true })
    await waitFor(() => expect(latestPaths().sort()).toEqual(['Lone.md', 'Topic.md']))
    await act(async () => {
      await flushGraphUi()
    })
    expect(mocked.patchUi).toHaveBeenCalledWith({ graph: { showTagsNetwork: true } }, { baseRevision: 'r0' })
  })

  test('tags network switch is offered only for a tag centre', async () => {
    const user = userEvent.setup()
    render(<LocalGraphPanel path="Ada.md" />)
    await sigmaReady()
    await user.click(screen.getByRole('button', { name: 'Customize' }))
    expect(await screen.findByRole('switch', { name: 'Show completed tasks' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Show tags network' })).toBeNull()
  })

  test('re-centres when the active object changes', async () => {
    const { rerender } = render(<LocalGraphPanel path="Ada.md" />)
    const sigma = await sigmaReady()
    await waitFor(() => expect(latestPaths().sort()).toEqual(['Ada.md', 'Charles.md']))
    rerender(<LocalGraphPanel path="Note.md" />)
    await waitFor(() => expect(latestPaths().sort()).toEqual(['Engine.md', 'Note.md']))
    // Same renderer, camera reset, graph data fetched once.
    expect(sigmaInstances).toHaveLength(1)
    expect(sigma.camera.animatedReset).toHaveBeenCalledTimes(1)
    expect(mocked.graph).toHaveBeenCalledTimes(1)
    const reducer = sigma.settings.nodeReducer as (k: string, a: Record<string, unknown>) => Record<string, unknown>
    expect(reducer('3', { path: 'Note.md', label: 'Note', size: 3, color: '#000', x: 0, y: 0 }).highlighted).toBe(true)
  })

  test('an object missing from the graph shows the empty state', async () => {
    render(<LocalGraphPanel path="Template.md" />)
    expect(await screen.findByText('Nothing to show')).toBeInTheDocument()
    expect(screen.getByText('This graph has no nodes yet.')).toBeInTheDocument()
    expect(screen.queryByTestId('graph-canvas')).toBeNull()
  })

  test('node click opens the note in the tab (M32)', async () => {
    render(<LocalGraphPanel path="Charles.md" />)
    const sigma = await sigmaReady()
    await waitFor(() => expect(latestPaths()).toHaveLength(3))
    act(() => sigma.emit('clickNode', { node: '2', event: { original: new MouseEvent('click') } }))
    expect(usePeek.getState().path).toBeNull()
    const tabs = useTabs.getState().tabs
    expect(tabs).toHaveLength(1)
    expect(tabs[0].history[tabs[0].index]).toEqual({ kind: 'object', path: 'Engine.md' })
  })

  test('with full pages off a node click peeks; ctrl+click opens a tab', async () => {
    setOpenAsFullPage(false)
    render(<LocalGraphPanel path="Charles.md" />)
    const sigma = await sigmaReady()
    await waitFor(() => expect(latestPaths()).toHaveLength(3))
    act(() => sigma.emit('clickNode', { node: '2', event: { original: new MouseEvent('click') } }))
    expect(usePeek.getState().path).toBe('Engine.md')
    expect(usePeek.getState().list).toEqual(['Ada.md', 'Charles.md', 'Engine.md'])
    expect(useTabs.getState().tabs).toHaveLength(0)

    act(() => sigma.emit('clickNode', { node: '0', event: { original: new MouseEvent('click', { metaKey: true }) } }))
    const tabs = useTabs.getState().tabs
    expect(tabs).toHaveLength(1)
    expect(tabs[0].history[0]).toEqual({ kind: 'object', path: 'Ada.md' })
  })

  test('labels match the catalog', async () => {
    const user = userEvent.setup()
    render(<LocalGraphPanel path="Charles.md" />)
    await sigmaReady()
    expect(screen.getByRole('heading', { name: 'Graph View' })).toBeInTheDocument()
    expect(screen.getByText('Maximum distance')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fit graph to view' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Find a note in this graph' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Customize' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument()
  })
})
