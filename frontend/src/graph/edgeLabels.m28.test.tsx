// M28 Task 6: the graph labels relation edges. An edge carries its pair's `linkLabels` entry as
// its `label`; the edge reducer shows it only on the edges of the hovered or highlighted node
// (as node labels around a hover), `''` elsewhere. A payload without `linkLabels` labels nothing.
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, GraphData } from '@/api/types'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('sigma', async () => (await import('./testSigma')).sigmaModule())
vi.mock('graphology-layout-forceatlas2/worker', async () => (await import('./testSigma')).fa2Module())

import { api } from '@/api/client'
import { graphData } from '@/test/mockApi'
import { GraphCanvas } from './GraphCanvas'
import { sigmaInstances, type FakeSigma } from './testSigma'
import { RELOAD_DELAY_MS, resetGraphData, useGraphData } from './useGraphData'

type EdgeReducer = (edge: string, attrs: Record<string, unknown>) => Record<string, unknown>
interface EdgeGraph {
  forEachEdge(cb: (edge: string, attrs: Record<string, unknown>, source: string, target: string) => void): void
}

afterEach(() => {
  sigmaInstances.length = 0
  vi.useRealTimers()
})

const node = (path: string) => ({ path, title: path, type: 'page', icon: null, degree: 1, tag: false, daily: false, done: false })

/** a – b – c, a and b linked by a relation, b and c by body text only. */
function labelled(withLabels: boolean): GraphData {
  return graphData({
    nodes: [node('a'), node('b'), node('c')],
    links: [0, 1, 1, 2],
    ...(withLabels ? { linkLabels: ['Runs on', null] } : {}),
  })
}

const visible = { nodes: [0, 1, 2], links: [[0, 1], [1, 2]] as [number, number][], reduced: [], tagLinks: [] }

/** Each edge's label after the edge reducer, by `"<source>-<target>"`. */
function shownLabels(sigma: FakeSigma): Record<string, unknown> {
  const reduce = sigma.settings.edgeReducer as EdgeReducer
  const out: Record<string, unknown> = {}
  ;(sigma.graph as unknown as EdgeGraph).forEachEdge((edge, attrs, s, t) => {
    out[`${s}-${t}`] = reduce(edge, attrs).label ?? ''
  })
  return out
}

async function mounted(data: GraphData, highlightPath?: string): Promise<FakeSigma> {
  render(<GraphCanvas data={data} visible={visible} custom={{}} onNodeClick={vi.fn()} highlightPath={highlightPath} />)
  await waitFor(() => expect(sigmaInstances.length).toBe(1))
  const sigma = sigmaInstances[0]
  await waitFor(() => expect(sigma.graph.size).toBe(2))
  return sigma
}

describe('graph edge labels', () => {
  test('hovering a node shows the labels of its edges only', async () => {
    const sigma = await mounted(labelled(true))
    expect(sigma.settings.renderEdgeLabels).toBe(true)
    // Nothing hovered: no edge label.
    expect(shownLabels(sigma)).toEqual({ '0-1': '', '1-2': '' })

    act(() => sigma.emit('enterNode', { node: '0' }))
    expect(shownLabels(sigma)).toEqual({ '0-1': 'Runs on', '1-2': '' })

    // c's only edge is a body link: nothing to show.
    act(() => sigma.emit('enterNode', { node: '2' }))
    expect(shownLabels(sigma)).toEqual({ '0-1': '', '1-2': '' })

    act(() => sigma.emit('enterNode', { node: '1' }))
    expect(shownLabels(sigma)).toEqual({ '0-1': 'Runs on', '1-2': '' })

    act(() => sigma.emit('leaveNode', { node: '1' }))
    expect(shownLabels(sigma)).toEqual({ '0-1': '', '1-2': '' })
  })

  test('the highlighted node (the local graph centre) shows its edge labels', async () => {
    const sigma = await mounted(labelled(true), 'b')
    expect(shownLabels(sigma)).toEqual({ '0-1': 'Runs on', '1-2': '' })
    // A hover elsewhere dims the centre's other edges, and their labels go with them.
    act(() => sigma.emit('enterNode', { node: '2' }))
    expect(shownLabels(sigma)).toEqual({ '0-1': '', '1-2': '' })
  })

  test('without linkLabels no edge has a label', async () => {
    const sigma = await mounted(labelled(false))
    ;(sigma.graph as unknown as EdgeGraph).forEachEdge((_e, attrs) => expect(attrs.label).toBeUndefined())
    act(() => sigma.emit('enterNode', { node: '1' }))
    expect(shownLabels(sigma)).toEqual({ '0-1': '', '1-2': '' })
  })

  test('the graph store passes linkLabels through, and a label change alone is a new graph', async () => {
    vi.useFakeTimers()
    resetGraphData()
    const mocked = vi.mocked(api)
    let listener: ((e: ChangeEvent) => void) | null = null
    mocked.onChange.mockImplementation((cb) => {
      listener = cb
      return () => {
        listener = null
      }
    })
    let next = labelled(true)
    mocked.graph.mockImplementation(async () => next)
    const { result } = renderHook(() => useGraphData())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.data?.linkLabels).toEqual(['Runs on', null])

    // A relation renamed in the type: same nodes and links, a new label.
    next = { ...labelled(true), linkLabels: ['Hosted on', null] }
    act(() => listener?.({ kind: 'types', path: '*', version: null }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RELOAD_DELAY_MS)
    })
    expect(result.current.data?.linkLabels).toEqual(['Hosted on', null])
    resetGraphData()
  })
})
