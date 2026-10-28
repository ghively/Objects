// The global graph page: header "Graph", the toolbar (search in the graph, fit, Customize), the
// sigma canvas over every visible object, and Capacities' empty states. A click peeks the node
// with the visible nodes as the pager list; Ctrl/Cmd+click opens it in a new tab.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { useLinkIndex } from '@/links/linkIndex'
import { usePeek, type OpenOptions, type Target } from '@/nav/tabs'
import { GraphCanvas } from './GraphCanvas'
import { GraphCustomization } from './GraphCustomization'
import { GraphLoading } from './GraphLoading'
import { GraphToolbar } from './GraphToolbar'
import { exportGraphPng, type GraphRenderer } from './exportPng'
import { bestMatch, filterGraph } from './filterGraph'
import { useGraphData } from './useGraphData'
import { useGraphUi } from './useGraphUi'

export const GRAPH_TEXT = {
  heading: 'Graph',
  emptyTitle: 'Nothing to show',
  emptyDescription: 'There is nothing in this graph yet.',
  emptyFiltered: 'The current filters are hiding everything in this graph.',
}

export interface GraphPageProps {
  onOpenTarget: (target: Target, opts?: OpenOptions) => void
}

/** Ctrl/Cmd+click opens a tab; a plain click peeks with `list` as the pager. */
export function openGraphNode(
  path: string,
  event: MouseEvent | TouchEvent | undefined,
  list: string[],
  onOpenTarget: (target: Target, opts?: OpenOptions) => void,
): void {
  const e = event as MouseEvent | undefined
  if (e && (e.ctrlKey || e.metaKey)) {
    onOpenTarget({ kind: 'object', path }, { newTab: true })
    return
  }
  usePeek.getState().peek(path, list)
}

export function GraphEmpty({ filtered }: { filtered: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center" data-testid="graph-empty">
      <p className="text-[15px] font-semibold">{GRAPH_TEXT.emptyTitle}</p>
      <p className="text-[13px] text-fg-muted">{filtered ? GRAPH_TEXT.emptyFiltered : GRAPH_TEXT.emptyDescription}</p>
    </div>
  )
}

export function GraphPage({ onOpenTarget }: GraphPageProps) {
  const { data } = useGraphData()
  const { custom, patch } = useGraphUi()
  const types = useLinkIndex((s) => s.types)
  const loaded = useLinkIndex((s) => s.loaded)
  useEffect(() => {
    if (!loaded) void useLinkIndex.getState().load()
  }, [loaded])

  const visible = useMemo(() => (data ? filterGraph(data, custom, { kind: 'global' }) : null), [data, custom])
  const visiblePaths = useMemo(() => (data && visible ? visible.nodes.map((i) => data.nodes[i].path) : []), [data, visible])
  const [layout, setLayout] = useState<{ running: boolean; progress: number }>({ running: false, progress: 0 })
  const [focusPath, setFocusPath] = useState<string | null>(null)
  const [fitSignal, setFitSignal] = useState(0)
  const rendererRef = useRef<GraphRenderer | null>(null)

  const onNodeClick = useCallback(
    (path: string, event: MouseEvent | TouchEvent | undefined) => openGraphNode(path, event, visiblePaths, onOpenTarget),
    [visiblePaths, onOpenTarget],
  )

  const onSearch = (q: string) => {
    if (!data || !visible) return
    const i = bestMatch(data, visible.nodes, q)
    if (i !== null) setFocusPath(data.nodes[i].path)
  }

  const empty = !!data && data.nodes.length === 0
  const filteredEmpty = !!data && !empty && !!visible && visible.nodes.length === 0
  const step = !data ? 0 : layout.running ? 3 : 4

  return (
    <div className="flex h-full min-h-0 w-full flex-col px-6 pt-5 pb-4">
      <header className="flex flex-wrap items-center gap-2.5 pb-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-hover-2">
          <Icon name="ph-graph" size={20} />
        </span>
        <h1 className="min-w-0 flex-1 text-[20px] font-bold md:text-[22px]">{GRAPH_TEXT.heading}</h1>
        <GraphToolbar
          onSearch={onSearch}
          onFit={() => setFitSignal((n) => n + 1)}
        onExport={() => exportGraphPng(rendererRef.current).catch((e: unknown) => console.warn('Could not export the graph:', e))}
          customize={<GraphCustomization custom={custom} onPatch={patch} types={types} tagsNetworkKey="showSpaceTagsNetwork" />}
        />
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-panel">
        {data && visible && !empty && !filteredEmpty && (
          <GraphCanvas
            data={data}
            visible={visible}
            custom={custom}
            onNodeClick={onNodeClick}
            focusPath={focusPath}
            fitSignal={fitSignal}
            onLayout={setLayout}
            rendererRef={rendererRef}
          />
        )}
        {empty && <GraphEmpty filtered={false} />}
        {filteredEmpty && <GraphEmpty filtered />}
        {(!data || (layout.running && !empty && !filteredEmpty)) && (
          <GraphLoading step={step} progress={layout.running ? layout.progress : undefined} />
        )}
      </div>
    </div>
  )
}
