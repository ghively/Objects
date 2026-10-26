// The toolbar pill, right-aligned: count, Filter, Sort, Group by, the layout picker and Customize.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Collection, Layout, TypeDef, ViewState } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { CustomizeMenu, type CustomizePage } from './CustomizeMenu'
import { FilterEditor } from './FilterEditor'
import type { Group } from './group'
import { GroupEditor } from './GroupEditor'
import { LAYOUTS } from './model'
import type { PropChoice } from './properties'
import { SortEditor } from './SortEditor'

/** Below this width the layout picker folds into Customize. */
const NARROW_PX = 480

export interface ToolbarProps {
  count: number
  state: ViewState
  onState(next: ViewState): void
  layouts: readonly Layout[]
  choices: PropChoice[]
  types: TypeDef[]
  collections: Collection[]
  groups: Group[]
  hidden: Group[]
  pausedHint?: string
  extraPages?: CustomizePage[]
  structureId?: string
}

function PillButton({
  label,
  icon,
  active,
  dim,
  title,
  children,
}: {
  label: string
  icon: string
  active?: boolean
  dim?: boolean
  title?: string
  children?: ReactNode
}) {
  return (
    <PopoverTrigger asChild>
      <button
        type="button"
        aria-label={label}
        title={title ?? label}
        data-active={active ? '' : undefined}
        className={cn(
          'flex h-7 items-center gap-0.5 rounded-md px-1.5 text-fg-muted hover:bg-hover hover:text-fg',
          active && 'bg-hover text-fg',
          dim && 'opacity-50',
        )}
      >
        <Icon name={icon} size={16} />
        {children}
      </button>
    </PopoverTrigger>
  )
}

export function Toolbar(p: ToolbarProps) {
  const { state, onState } = p
  const ref = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    // The toolbar only takes the width it needs (so a heading beside it keeps its room); how
    // narrow the view is shows in the row it sits in.
    const el = ref.current?.closest<HTMLElement>('[data-toolbar-row]') ?? ref.current?.parentElement ?? ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      // An unmeasured (zero-width) row counts as wide.
      const w = entries[0]?.contentRect.width ?? 0
      setNarrow(w > 0 && w < NARROW_PX)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const layout = state.viewDefinition.dataViewLayout
  const hasFilter = state.filterGroup.elements.length > 0
  const activeLayout = LAYOUTS[layout] ?? LAYOUTS.list
  const pick = (l: Layout) => onState({ ...state, viewDefinition: { ...state.viewDefinition, dataViewLayout: l } })
  const hint = p.pausedHint

  return (
    <div ref={ref} data-testid="toolbar" className="ml-auto flex shrink-0 justify-end">
      <div className="flex items-center gap-0.5 rounded-lg border border-line bg-raised px-1 py-0.5 text-[13px]">
        <span title={p.count === 1 ? '1 entry' : `${p.count} entries`} className="px-1.5 text-fg-muted">
          {p.count}
        </span>
        <Popover>
          <PillButton label="Filter" icon="ph-funnel-simple" active={hasFilter} dim={!!hint} title={hint ?? 'Filter'} />
          <PopoverContent align="end" className="w-auto max-w-[95vw] border-line bg-raised p-0">
            <FilterEditor
              group={state.filterGroup}
              onChange={(g) => onState({ ...state, filterGroup: g })}
              choices={p.choices}
              types={p.types}
              collections={p.collections}
            />
          </PopoverContent>
        </Popover>
        <Popover>
          <PillButton label="Sort" icon="ph-sort-ascending" active={state.sorts.length > 0} dim={!!hint} title={hint ?? 'Sort'} />
          <PopoverContent align="end" className="w-auto border-line bg-raised p-0">
            <SortEditor sorts={state.sorts} onChange={(s) => onState({ ...state, sorts: s })} choices={p.choices} />
          </PopoverContent>
        </Popover>
        <Popover>
          <PillButton label="Group by" icon="ph-square-split-vertical" active={!!state.groupBy?.groups?.length} />
          <PopoverContent align="end" className="w-auto border-line bg-raised p-0">
            <GroupEditor groupBy={state.groupBy} onChange={(g) => onState({ ...state, groupBy: g })} choices={p.choices} />
          </PopoverContent>
        </Popover>
        {!narrow && p.layouts.length > 1 && (
          <Popover>
            <PillButton label="Layout" icon={activeLayout.icon}>
              <Icon name="ph-caret-down" size={11} />
            </PillButton>
            <PopoverContent align="end" className="w-48 border-line bg-raised p-1">
              <div className="px-2 py-1 text-[12px] text-fg-muted">Layout</div>
              {p.layouts.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={layout === l}
                  onClick={() => pick(l)}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
                >
                  <Icon name={LAYOUTS[l].icon} size={15} />
                  <span className="flex-1">{LAYOUTS[l].label}</span>
                  {layout === l && <Icon name="ph-check" size={14} />}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}
        <Popover>
          <PillButton label="Customize view" icon="ph-sliders-horizontal" />
          <PopoverContent align="end" className="w-auto border-line bg-raised p-0">
            <CustomizeMenu
              state={state}
              onState={onState}
              choices={p.choices}
              groups={p.groups}
              hidden={p.hidden}
              layouts={narrow ? p.layouts : undefined}
              extraPages={p.extraPages}
              structureId={p.structureId}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
