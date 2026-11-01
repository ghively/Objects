import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('sigma', async () => (await import('./testSigma')).sigmaModule())
vi.mock('graphology-layout-forceatlas2/worker', async () => (await import('./testSigma')).fa2Module())

import { graphData } from '@/test/mockApi'
import { BUILD_SLICE, GraphCanvas } from './GraphCanvas'
import { REDUCED_NODE_SIZE } from './graphStyle'
import { sigmaInstances } from './testSigma'

const root = document.documentElement

afterEach(() => {
  root.removeAttribute('data-theme')
  root.classList.add('dark')
  root.style.removeProperty('--line-gray')
  root.style.removeProperty('--text')
  sigmaInstances.length = 0
})

describe('GraphCanvas', () => {
  test('test graph and whiteboard canvases follow a theme change (graph)', async () => {
    root.style.setProperty('--line-gray', '#111111')
    root.style.setProperty('--text', '#eeeeee')
    const data = graphData({
      nodes: [{ path: 'Pages/A.md', title: 'A', type: 'nope', icon: null, degree: 0, tag: false, daily: false, done: false }],
    })
    render(<GraphCanvas data={data} visible={{ nodes: [0], links: [], reduced: [], tagLinks: [] }} custom={{}} onNodeClick={vi.fn()} />)
    await waitFor(() => expect(sigmaInstances.length).toBe(1))
    const sigma = sigmaInstances[0]
    const color = () => sigma.graph.getNodeAttribute('0', 'color')
    expect(color()).toBe('#111111')
    expect(sigma.settings.labelColor).toEqual({ color: '#eeeeee' })

    // The light theme's tokens: the nodes and labels repaint, without a new renderer.
    root.style.setProperty('--line-gray', '#222222')
    root.style.setProperty('--text', '#333333')
    await act(async () => {
      root.setAttribute('data-theme', 'light')
      root.classList.remove('dark')
      await Promise.resolve()
    })
    await waitFor(() => expect(color()).toBe('#222222'))
    expect(sigma.settings.labelColor).toEqual({ color: '#333333' })
    expect(sigmaInstances.length).toBe(1)
  })

  test('reduced nodes are drawn small, gray and unlabelled; edges are links and tag edges only', async () => {
    const node = (path: string, type: string) => ({ path, title: path, type, icon: null, degree: 2, tag: false, daily: false, done: false })
    const data = graphData({ nodes: [node('a', 'page'), node('x', 'person'), node('b', 'page')], links: [0, 1, 1, 2] })
    const { getByTestId } = render(
      <GraphCanvas data={data} visible={{ nodes: [0, 1, 2], links: [[0, 1], [1, 2]], reduced: [1], tagLinks: [] }} custom={{}} onNodeClick={vi.fn()} />,
    )
    await waitFor(() => expect(sigmaInstances.length).toBe(1))
    const g = sigmaInstances[0].graph
    expect(g.getNodeAttribute('1', 'size')).toBe(REDUCED_NODE_SIZE)
    expect(g.getNodeAttribute('1', 'themeColor')).toBe('gray')
    expect(g.getNodeAttribute('1', 'reduced')).toBe(true)
    expect(g.getNodeAttribute('0', 'reduced')).toBeUndefined()
    expect(g.size).toBe(2)
    expect(getByTestId('graph-canvas')).toHaveAttribute('data-reduced-count', '1')
  })

  test('a rebuild hands sigma a new, positioned graph in one setGraph; the shown one is left alone', async () => {
    const node = (path: string) => ({ path, title: path, type: 'page', icon: null, degree: 1, tag: false, daily: false, done: false })
    const data = graphData({ nodes: [node('a'), node('b'), node('c')], links: [0, 1, 1, 2] })
    const onClick = vi.fn()
    const { rerender } = render(
      <GraphCanvas data={data} visible={{ nodes: [0, 1], links: [[0, 1]], reduced: [], tagLinks: [] }} custom={{}} onNodeClick={onClick} />,
    )
    await waitFor(() => expect(sigmaInstances.length).toBe(1))
    const sigma = sigmaInstances[0]
    await waitFor(() => expect(sigma.graph.order).toBe(2))
    const first = sigma.graph
    const setsBefore = sigma.graphsSet
    rerender(
      <GraphCanvas data={data} visible={{ nodes: [0, 1, 2], links: [[0, 1], [1, 2]], reduced: [], tagLinks: [] }} custom={{}} onNodeClick={onClick} />,
    )
    await waitFor(() => expect(sigma.graph.order).toBe(3))
    expect(sigma.graphsSet).toBe(setsBefore + 1)
    expect(first.order).toBe(2)
    sigma.graph.forEachNode((_k, a) => {
      expect(Number.isFinite(a.x)).toBe(true)
      expect(Number.isFinite(a.y)).toBe(true)
    })
    // Clicks resolve against the graph on screen.
    sigma.emit('clickNode', { node: '2' })
    expect(onClick).toHaveBeenCalledWith('c', undefined)
  })

  test('a big graph is built in slices, letting other tasks run before it is done', async () => {
    const N = BUILD_SLICE * 3
    const nodes = Array.from({ length: N }, (_, i) => ({ path: `P/${i}.md`, title: `${i}`, type: 'page', icon: null, degree: 1, tag: false, daily: false, done: false }))
    const data = graphData({ nodes, links: [] })
    const visible = { nodes: nodes.map((_, i) => i), links: Array.from({ length: N - 1 }, (_, i) => [i, i + 1] as [number, number]), reduced: [], tagLinks: [] }
    let otherTaskRan = false
    let ranBeforeDone: boolean | null = null
    const onLayout = (s: { running: boolean }) => {
      if (s.running && ranBeforeDone === null) ranBeforeDone = otherTaskRan
    }
    render(<GraphCanvas data={data} visible={visible} custom={{}} onNodeClick={vi.fn()} onLayout={onLayout} />)
    setTimeout(() => (otherTaskRan = true), 0)
    await waitFor(() => expect(ranBeforeDone).not.toBeNull())
    expect(ranBeforeDone).toBe(true)
    await waitFor(() => expect(sigmaInstances[0]?.graph.order).toBe(N))
    expect(sigmaInstances[0].graph.size).toBe(N - 1)
  })
})
