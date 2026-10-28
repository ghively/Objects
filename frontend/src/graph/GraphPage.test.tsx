import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, GraphData, GraphNode } from '@/api/types'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('sigma', async () => (await import('./testSigma')).sigmaModule())
vi.mock('graphology-layout-forceatlas2/worker', async () => (await import('./testSigma')).fa2Module())

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek } from '@/nav/tabs'
import { resetPinned, useUiStore } from '@/shell/usePinned'
import { graphData, typeDef } from '@/test/mockApi'
import { GraphPage } from './GraphPage'
import { LOADING_STEPS } from './GraphLoading'
import { latestPaths, sigmaInstances } from './testSigma'
import { RELOAD_DELAY_MS, resetGraphData, useGraphDataStore } from './useGraphData'
import { resetGraphUi } from './useGraphUi'

const mocked = vi.mocked(api)

function node(path: string, partial: Partial<GraphNode> = {}): GraphNode {
  return { path, title: path.replace(/\.md$/, ''), type: 'page', icon: null, degree: 1, tag: false, daily: false, done: false, ...partial }
}

const DATA: GraphData = graphData({
  nodes: [node('Ada Lovelace.md'), node('Charles Babbage.md'), node('Analytical Engine.md'), node('Done.md', { type: 'task', done: true })],
  links: [0, 1, 1, 2, 2, 3],
})

/** The page's sigma, once its lazy import has resolved. */
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
  sigmaInstances.length = 0
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  mocked.graph.mockImplementation(async () => DATA)
  useLinkIndex.setState({ types: [typeDef({ id: 'page', name: 'Page', color: 'teal' })], objects: [], loaded: true })
  setUi()
})

describe('GraphPage', () => {
  test('page shows loading steps, then the canvas; empty and filtered-empty states', async () => {
    let resolve!: (d: GraphData) => void
    mocked.graph.mockImplementationOnce(() => new Promise<GraphData>((r) => (resolve = r)))
    const { unmount } = render(<GraphPage onOpenTarget={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Graph' })).toBeInTheDocument()
    const loading = screen.getByTestId('graph-loading')
    for (const step of LOADING_STEPS) expect(loading).toHaveTextContent(step)
    expect(screen.getByText('Reading objects')).toHaveAttribute('data-state', 'active')
    expect(screen.queryByTestId('graph-canvas')).toBeNull()

    await act(async () => resolve(DATA))
    const canvas = await screen.findByTestId('graph-canvas')
    await sigmaReady()
    // The done task is hidden by default.
    expect(canvas).toHaveAttribute('data-node-count', '3')
    expect(latestPaths()).toEqual(['Ada Lovelace.md', 'Charles Babbage.md', 'Analytical Engine.md'])
    await waitFor(() => expect(screen.queryByTestId('graph-loading')).toBeNull())
    unmount()

    // Nothing in the space.
    resetGraphData()
    mocked.graph.mockImplementation(async () => graphData())
    const empty = render(<GraphPage onOpenTarget={vi.fn()} />)
    expect(await screen.findByText('Nothing to show')).toBeInTheDocument()
    expect(screen.getByText('There is nothing in this graph yet.')).toBeInTheDocument()
    empty.unmount()

    // Filters hide everything.
    resetGraphData()
    mocked.graph.mockImplementation(async () => DATA)
    setUi({ excludeStructureIds: ['page', 'task'] })
    render(<GraphPage onOpenTarget={vi.fn()} />)
    expect(await screen.findByText('The current filters are hiding everything in this graph.')).toBeInTheDocument()
    expect(screen.getByText('Nothing to show')).toBeInTheDocument()
  })

  test('node click peeks with visible nodes; ctrl+click opens a tab', async () => {
    const onOpenTarget = vi.fn()
    render(<GraphPage onOpenTarget={onOpenTarget} />)
    const sigma = await sigmaReady()
    act(() => sigma.emit('clickNode', { node: '1', event: { original: new MouseEvent('click') } }))
    expect(usePeek.getState().path).toBe('Charles Babbage.md')
    expect(usePeek.getState().list).toEqual(['Ada Lovelace.md', 'Charles Babbage.md', 'Analytical Engine.md'])
    expect(onOpenTarget).not.toHaveBeenCalled()

    act(() => sigma.emit('clickNode', { node: '2', event: { original: new MouseEvent('click', { ctrlKey: true }) } }))
    expect(onOpenTarget).toHaveBeenCalledWith({ kind: 'object', path: 'Analytical Engine.md' }, { newTab: true })
  })

  test('search in graph focuses the best match; fit resets the camera', async () => {
    const user = userEvent.setup()
    render(<GraphPage onOpenTarget={vi.fn()} />)
    const sigma = await sigmaReady()
    const search = screen.getByRole('searchbox', { name: 'Search for a note in the graph' })
    await user.type(search, 'babage{Enter}')
    expect(sigma.camera.animate).toHaveBeenCalledTimes(1)
    expect(sigma.camera.animate).toHaveBeenCalledWith({ x: 0.5, y: 0.25, ratio: expect.any(Number) }, expect.anything())
    // A hidden node (the done task) is never focused.
    await user.clear(search)
    await user.type(search, 'Done{Enter}')
    expect(sigma.camera.animate).toHaveBeenCalledTimes(1)

    expect(sigma.camera.animatedReset).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Fit graph to view' }))
    expect(sigma.camera.animatedReset).toHaveBeenCalledTimes(1)
  })

  test('test export button downloads graph png', async () => {
    const user = userEvent.setup()
    const drawn: HTMLCanvasElement[] = []
    const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: (c: HTMLCanvasElement) => drawn.push(c) }
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => ctx as unknown as CanvasRenderingContext2D)
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((cb, type) => cb(new Blob(['png'], { type: type ?? '' })))
    const blobs: Blob[] = []
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      blobs.push(b as Blob)
      return 'blob:graph'
    })
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const downloads: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download)
    })
    try {
      render(<GraphPage onOpenTarget={vi.fn()} />)
      const sigma = await sigmaReady()
      const before = sigma.refreshes
      await user.click(screen.getByRole('button', { name: 'Export view as PNG' }))
      await waitFor(() => expect(downloads).toEqual(['graph.png']))
      expect(sigma.refreshes).toBe(before + 1)
      expect(drawn).toEqual(Object.values(sigma.canvases))
      expect(blobs.map((b) => b.type)).toEqual(['image/png'])
    } finally {
      for (const s of [getContext, toBlob, createUrl, revoke, click]) s.mockRestore()
    }
  })

  test('show simplified graph hides labels', async () => {
    setUi({ showMinimalNodes: true })
    render(<GraphPage onOpenTarget={vi.fn()} />)
    const sigma = await sigmaReady()
    expect(sigma.settings.renderLabels).toBe(false)
  })

  test('graph data reloads once on a burst of change events', async () => {
    let listener: ((e: ChangeEvent) => void) | null = null
    mocked.onChange.mockImplementation((cb: (e: ChangeEvent) => void) => {
      listener = cb
      return () => {
        listener = null
      }
    })
    vi.useFakeTimers()
    try {
      const { unmount } = render(<GraphPage onOpenTarget={vi.fn()} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(mocked.graph).toHaveBeenCalledTimes(1)
      act(() => {
        listener?.({ kind: 'changed', path: 'Ada Lovelace.md', version: 'v2' })
        listener?.({ kind: 'created', path: 'New.md', version: 'v1' })
        listener?.({ kind: 'renamed', path: 'B.md', oldPath: 'A.md', version: 'v1' })
        listener?.({ kind: 'ui', path: 'ui.json', version: 'r2' })
        listener?.({ kind: 'types', path: 'page', version: null })
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RELOAD_DELAY_MS - 1)
      })
      expect(mocked.graph).toHaveBeenCalledTimes(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(mocked.graph).toHaveBeenCalledTimes(2)
      // Only object and type changes reload.
      act(() => listener?.({ kind: 'ui', path: 'ui.json', version: 'r3' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RELOAD_DELAY_MS * 2)
      })
      expect(mocked.graph).toHaveBeenCalledTimes(2)
      expect(useGraphDataStore.getState().data).toBe(DATA)
      unmount()
      expect(listener).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
