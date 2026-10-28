/**
 * The side panel (Object's three-area sidepanel), per tab: a column at the right of the main card
 * behind a 1 px rule. Each area with an open entry is shown, stacked area 1, area 2, area 3; areas
 * 2 and 3 are `area2Size`/`area3Size` px high (220 by default, 120 at least) and the first shown
 * area takes the rest (120 px at least). The width is a share of the main column plus the panel
 * (`sidepanelWidth`: 45 % by default, dragged between 10 % and 90 %, a double click on the resizer
 * goes back to 45 %). Resizers write the tab's layout on pointer up. Values from the reference
 * (`LocationManager`, `storing` `sidepanelWidth`).
 *
 * M8: an entry dragged by its title and dropped anywhere on the main view (`[data-main-column]`)
 * swaps with it, as "Swap" does ("Drag onto the main content to swap."). The drop is taken in the
 * capture phase, only for that drag's data, so the main view's own drop targets never see it.
 */
import { Fragment, useEffect, useRef, useState } from 'react'
import type { SpaceInfo } from '@/api/types'
import {
  areaSizes,
  clampWidthFraction,
  DEFAULT_SIDEPANEL_FRACTION,
  entriesOf,
  isSidepanelShown,
  MIN_AREA_SIZE,
  visibleAreas,
  widthFraction,
  type PanelArea,
} from '@/nav/sidepanel'
import { activeTab, useTabs } from '@/nav/tabs'
import { Resizer } from './Resizer'
import { SIDEPANEL_ENTRY_MIME, SidePanelArea, type RenderSidepanelTarget } from './SidePanelArea'

function carriesEntry(e: DragEvent): boolean {
  const types = e.dataTransfer?.types
  return !!types && Array.from(types).includes(SIDEPANEL_ENTRY_MIME)
}

function overMain(e: DragEvent): boolean {
  const el = e.target instanceof Element ? e.target : null
  return !!el?.closest('[data-main-column]')
}

/** While mounted, a side-panel entry dropped on the main view swaps with it. */
function useDropToSwap(): void {
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!carriesEntry(e) || !overMain(e)) return
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    }
    const drop = (e: DragEvent) => {
      if (!carriesEntry(e) || !overMain(e)) return
      e.preventDefault()
      e.stopPropagation()
      const id = e.dataTransfer?.getData(SIDEPANEL_ENTRY_MIME)
      if (id) useTabs.getState().swapWithMain(id)
    }
    document.addEventListener('dragenter', over, true)
    document.addEventListener('dragover', over, true)
    document.addEventListener('drop', drop, true)
    return () => {
      document.removeEventListener('dragenter', over, true)
      document.removeEventListener('dragover', over, true)
      document.removeEventListener('drop', drop, true)
    }
  }, [])
}

export interface SidePanelProps {
  space: SpaceInfo | null
  renderTarget: RenderSidepanelTarget
}

export function SidePanel({ space, renderTarget }: SidePanelProps) {
  const tab = useTabs((s) => activeTab(s))
  const ref = useRef<HTMLElement | null>(null)
  // Live sizes while a resizer is dragged (written to the tab on pointer up).
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [dragArea, setDragArea] = useState<{ area: PanelArea; size: number } | null>(null)
  useDropToSwap()
  if (!tab || !isSidepanelShown(tab)) return null

  const entries = entriesOf(tab)
  const visible = visibleAreas(entries)
  const layout = tab.sidepanelLayout
  const savedWidth = widthFraction(layout)
  const width = dragWidth ?? savedWidth
  const sizes = areaSizes(layout, visible)
  if (dragArea) sizes[dragArea.area] = dragArea.size

  // The main column plus the panel: the card the panel sits in.
  const widthFor = (delta: number) => {
    const total = ref.current?.parentElement?.getBoundingClientRect().width ?? 0
    return total > 0 ? clampWidthFraction((savedWidth * total - delta) / total) : savedWidth
  }
  const sizeFor = (area: PanelArea, delta: number) => {
    const saved = areaSizes(layout, visible)
    const start = saved[area] ?? MIN_AREA_SIZE
    const height = ref.current?.getBoundingClientRect().height ?? 0
    // Area 1 (the first shown) keeps its 120 px minimum.
    const others = visible.slice(1).reduce((n, a) => (a === area ? n : n + (saved[a] ?? 0)), 0)
    const max = height > 0 ? Math.max(MIN_AREA_SIZE, height - MIN_AREA_SIZE - others) : Infinity
    return Math.round(Math.min(max, Math.max(MIN_AREA_SIZE, start - delta)))
  }
  const layoutKey = (area: PanelArea) => (area === 'area3' ? 'area3Size' : 'area2Size')

  return (
    <aside
      ref={ref}
      aria-label="Side panel"
      data-tab={tab.id}
      style={{ width: `${+(width * 100).toFixed(2)}%` }}
      className="relative flex h-full shrink-0 border-l border-line bg-panel"
    >
      <Resizer
        direction="x"
        label="Resize side panel"
        className="absolute inset-y-0 left-0 z-10 -translate-x-1/2"
        onDrag={(d) => setDragWidth(widthFor(d))}
        onEnd={(d) => {
          setDragWidth(null)
          if (d !== 0) useTabs.getState().setSidepanelLayout({ width: widthFor(d) })
        }}
        onDoubleClick={() => useTabs.getState().setSidepanelLayout({ width: DEFAULT_SIDEPANEL_FRACTION })}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {visible.map((area, i) => (
          <Fragment key={area}>
            {i > 0 && (
              <Resizer
                direction="y"
                label={`Resize side panel area ${area.slice(-1)}`}
                className="border-t border-line"
                onDrag={(d) => setDragArea({ area, size: sizeFor(area, d) })}
                onEnd={(d) => {
                  setDragArea(null)
                  if (d !== 0) useTabs.getState().setSidepanelLayout({ [layoutKey(area)]: sizeFor(area, d) })
                }}
              />
            )}
            <div
              data-testid={`sidepanel-${area}`}
              className="min-h-0 overflow-hidden"
              style={i === 0 ? { flex: '1 1 0', minHeight: MIN_AREA_SIZE } : { flex: `0 0 ${sizes[area] ?? MIN_AREA_SIZE}px` }}
            >
              <SidePanelArea
                area={area}
                entries={entries.filter((e) => e.panelArea === area)}
                space={space}
                renderTarget={renderTarget}
              />
            </div>
          </Fragment>
        ))}
      </div>
    </aside>
  )
}
