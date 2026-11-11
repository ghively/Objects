// M31 item 8: the graph's controls (catalog §7): top right a count pill, "Open as list" and
// "Recently opened"; bottom right zoom out, the zoom menu (Page Fit, 5% … 300%), zoom in,
// "Export view as PNG" and Customize.
import { act, render, screen, waitFor, within } from '@testing-library/react'
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
import { useRecent } from '@/nav/recent'
import { usePeek } from '@/nav/tabs'
import { resetPinned, useUiStore } from '@/shell/usePinned'
import { graphData, typeDef } from '@/test/mockApi'
import { GRAPH_CONTROLS_TEXT as T, nextZoom, ZOOM_STEPS } from './GraphControls'
import { GraphPage } from './GraphPage'
import { sigmaInstances } from './testSigma'
import { resetGraphData } from './useGraphData'
import { resetGraphUi } from './useGraphUi'

const mocked = vi.mocked(api)

function node(path: string, partial: Partial<GraphNode> = {}): GraphNode {
  return { path, title: path.replace(/\.md$/, ''), type: 'page', icon: null, degree: 1, tag: false, daily: false, done: false, ...partial }
}

const DATA: GraphData = graphData({
  nodes: [node('Charles Babbage.md'), node('Ada Lovelace.md'), node('Analytical Engine.md'), node('Done.md', { type: 'task', done: true })],
  links: [0, 1, 1, 2, 2, 3],
})

async function sigmaReady() {
  await screen.findByTestId('graph-canvas')
  await waitFor(() => expect(sigmaInstances.length).toBeGreaterThan(0))
  return sigmaInstances[sigmaInstances.length - 1]
}

beforeEach(() => {
  resetGraphData()
  resetGraphUi()
  resetPinned()
  resetLinkIndex()
  usePeek.getState().close()
  useRecent.getState().clear()
  sigmaInstances.length = 0
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  mocked.graph.mockImplementation(async () => DATA)
  useLinkIndex.setState({ types: [typeDef({ id: 'page', name: 'Page', color: 'teal' })], objects: [], loaded: true })
  useUiStore.setState({ ui: { pinned: [], sections: [], allNotesLayout: 'list', graph: {} }, revision: 'r0', loaded: true })
})

describe('zoom steps', () => {
  test('zoom in and out move to the next step, and stop at the ends', () => {
    expect(ZOOM_STEPS).toEqual([5, 10, 25, 50, 75, 100, 150, 200, 300])
    expect(nextZoom(100, 1)).toBe(150)
    expect(nextZoom(100, -1)).toBe(75)
    expect(nextZoom(120, 1)).toBe(150)
    expect(nextZoom(120, -1)).toBe(100)
    expect(nextZoom(300, 1)).toBeNull()
    expect(nextZoom(5, -1)).toBeNull()
    expect(nextZoom(400, -1)).toBe(300)
    expect(nextZoom(2, 1)).toBe(5)
  })
})

describe('graph controls', () => {
  test('the count pill shows the notes shown after the filters', async () => {
    render(<GraphPage onOpenTarget={vi.fn()} />)
    await sigmaReady()
    // The done task is hidden by default.
    const pill = screen.getByTestId('graph-count')
    expect(pill).toHaveTextContent('3')
    expect(pill).toHaveAttribute('title', T.count(3))
  })

  test('the zoom menu, zoom in and zoom out drive the camera; Page Fit resets it', async () => {
    const user = userEvent.setup()
    render(<GraphPage onOpenTarget={vi.fn()} />)
    const sigma = await sigmaReady()
    const zoom = screen.getByRole('button', { name: T.zoom })
    expect(zoom).toHaveTextContent('100%')

    await user.click(zoom)
    const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent)
    expect(items).toEqual(['Page Fit', '5%', '10%', '25%', '50%', '75%', '100%', '150%', '200%', '300%'])
    await user.click(screen.getByRole('menuitem', { name: '200%' }))
    expect(sigma.camera.animate).toHaveBeenLastCalledWith({ ratio: 0.5 }, expect.anything())
    await waitFor(() => expect(zoom).toHaveTextContent('200%'))

    await user.click(screen.getByRole('button', { name: T.zoomIn }))
    expect(sigma.camera.animate).toHaveBeenLastCalledWith({ ratio: 100 / 300 }, expect.anything())
    await waitFor(() => expect(zoom).toHaveTextContent('300%'))
    expect(screen.getByRole('button', { name: T.zoomIn })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: T.zoomOut }))
    expect(sigma.camera.animate).toHaveBeenLastCalledWith({ ratio: 0.5 }, expect.anything())

    // A wheel zoom (the camera moved by itself) shows in the menu's label.
    act(() => {
      sigma.camera.ratio = 4
      void sigma.camera.animate({ ratio: 4 })
    })
    await waitFor(() => expect(zoom).toHaveTextContent('25%'))

    expect(sigma.camera.animatedReset).not.toHaveBeenCalled()
    await user.click(zoom)
    await user.click(await screen.findByRole('menuitem', { name: T.pageFit }))
    expect(sigma.camera.animatedReset).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(zoom).toHaveTextContent('100%'))
  })

  test('Open as list lists the notes shown; a pick peeks it with them as the pager', async () => {
    const user = userEvent.setup()
    const onOpenTarget = vi.fn()
    render(<GraphPage onOpenTarget={onOpenTarget} />)
    await sigmaReady()
    await user.click(screen.getByRole('button', { name: T.openAsList }))
    const list = await screen.findByRole('list', { name: T.listHeading })
    const names = within(list).getAllByRole('button').map((b) => b.textContent)
    expect(names).toEqual(['Ada Lovelace', 'Analytical Engine', 'Charles Babbage'])
    await user.click(within(list).getByRole('button', { name: 'Ada Lovelace' }))
    expect(usePeek.getState().path).toBe('Ada Lovelace.md')
    expect(usePeek.getState().list).toEqual(['Ada Lovelace.md', 'Analytical Engine.md', 'Charles Babbage.md'])
    expect(onOpenTarget).not.toHaveBeenCalled()
  })

  test('Recently opened lists the recent objects in this graph; a pick finds it on the graph', async () => {
    const user = userEvent.setup()
    useRecent.setState({ paths: ['Done.md', 'Elsewhere.md', 'Analytical Engine.md', 'Ada Lovelace.md'], openedAt: {} })
    render(<GraphPage onOpenTarget={vi.fn()} />)
    const sigma = await sigmaReady()
    await user.click(screen.getByRole('button', { name: T.recent }))
    const list = await screen.findByRole('list', { name: T.recentHeading })
    // Hidden (the done task) and missing objects are left out; newest first.
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['Analytical Engine', 'Ada Lovelace'])
    await user.click(within(list).getByRole('button', { name: 'Analytical Engine' }))
    expect(sigma.camera.animate).toHaveBeenLastCalledWith({ x: 0.5, y: 0.25, ratio: expect.any(Number) }, expect.anything())
    expect(usePeek.getState().path).toBeNull()

    // Picking the same one again finds it again.
    const before = sigma.camera.animate.mock.calls.length
    await user.click(screen.getByRole('button', { name: T.recent }))
    await user.click(within(await screen.findByRole('list', { name: T.recentHeading })).getByRole('button', { name: 'Analytical Engine' }))
    expect(sigma.camera.animate.mock.calls.length).toBe(before + 1)
  })

  test('nothing recent in the graph says so', async () => {
    const user = userEvent.setup()
    render(<GraphPage onOpenTarget={vi.fn()} />)
    await sigmaReady()
    await user.click(screen.getByRole('button', { name: T.recent }))
    expect(await screen.findByText(T.noRecent)).toBeInTheDocument()
  })

  test('download and Customize sit with the zoom controls', async () => {
    render(<GraphPage onOpenTarget={vi.fn()} />)
    await sigmaReady()
    const group = screen.getByRole('toolbar', { name: T.viewControls })
    expect(within(group).getByRole('button', { name: 'Export view as PNG' })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Customize' })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: T.zoom })).toBeInTheDocument()
    // The search field stays in the header.
    expect(screen.getByRole('searchbox', { name: 'Find a note in this graph' })).toBeInTheDocument()
  })
})
