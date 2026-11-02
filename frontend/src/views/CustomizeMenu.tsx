// "Customize view" (w-64): group customization and column calculations here; the Table and
// Card view pages come from `extraPages`.
import { useState, type ReactNode } from 'react'
import type { DataViewDefinition, Layout, ViewState } from '@/api/types'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { CALC_KINDS, CALC_LABELS } from './calc'
import { findGroupConfig, type Group } from './group'
import { LAYOUTS } from './model'
import { choiceFor, type PropChoice } from './properties'

export interface CustomizePage {
  key: string
  label: string
  icon: string
  body: ReactNode
}

export interface CustomizeMenuProps {
  state: ViewState
  onState(next: ViewState): void
  choices: PropChoice[]
  /** Visible and hidden groups of the current grouping. */
  groups: Group[]
  hidden: Group[]
  /** The layout picker folded into this menu on a narrow toolbar. */
  layouts?: readonly Layout[]
  extraPages?: CustomizePage[]
  /** The type id calculations apply to when the view spans one type. */
  structureId?: string
  /** A reduced menu: only Calculations (the Calendar sections', as in Capacities). */
  only?: 'calcs'
}

const SELECT = 'h-7 max-w-full rounded-md border border-line bg-raised px-1.5 text-[13px] text-fg outline-none'

type Config = NonNullable<DataViewDefinition['groupByConfig']>

function Item({ icon, children, onClick, trailing }: { icon?: string; children: ReactNode; onClick(): void; trailing?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover">
      {icon && <Icon name={icon} size={15} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </button>
  )
}

export function CustomizeMenu({ state, onState, choices, groups, hidden, layouts, extraPages = [], structureId, only }: CustomizeMenuProps) {
  const [page, setPage] = useState<string | null>(null)
  const def = state.viewDefinition
  const setDef = (patch: Partial<DataViewDefinition>) => onState({ ...state, viewDefinition: { ...def, ...patch } })

  const back = (title: string) => (
    <button type="button" onClick={() => setPage(null)} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] font-medium hover:bg-hover">
      <Icon name="ph-caret-left" size={14} />
      {title}
    </button>
  )

  const extra = extraPages.find((p) => p.key === page)
  if (extra) {
    return (
      <div className="flex w-64 flex-col p-1">
        {back(extra.label)}
        {extra.body}
      </div>
    )
  }

  if (page === 'groups') {
    const cfg: Config = def.groupByConfig ?? { groups: [] }
    const all = [...groups, ...hidden]
    const hiddenIds = new Set(hidden.map((g) => g.id))
    const setCfg = (next: Partial<Config>) => setDef({ groupByConfig: { ...cfg, ...next } })
    const flag = (id: string, isHidden: boolean) => {
      const have = findGroupConfig(cfg.groups, id)
      // A legacy (bare-id) entry is rewritten under the group's current id.
      const next = have
        ? cfg.groups.map((g) => (g === have ? { ...g, id, isHidden } : g))
        : [...cfg.groups, { id, isHidden, isClosed: false }]
      setCfg({ groups: next })
    }
    const setAll = (isHidden: boolean) => {
      const byId = new Map(cfg.groups.map((g) => [g.id, g]))
      for (const g of all) {
        const have = findGroupConfig(cfg.groups, g.id)
        if (have && have.id !== g.id) byId.delete(have.id)
        byId.set(g.id, { id: g.id, isClosed: have?.isClosed ?? false, isHidden })
      }
      // Keep the config's own order for known groups, then the rest in view order.
      setCfg({ groups: [...byId.values()] })
    }
    const row = (g: Group, isHidden: boolean) => (
      <Item key={g.id} onClick={() => flag(g.id, !isHidden)} trailing={<Icon name={isHidden ? 'ph-eye-slash' : 'ph-eye'} size={14} />}>
        {g.label}
      </Item>
    )
    return (
      <div className="flex w-64 flex-col p-1">
        {back('Customize groups')}
        {!state.groupBy?.groups?.length ? (
          <p className="px-2 py-1 text-[13px] text-fg-muted">Group the view by a property first.</p>
        ) : (
          <>
            <div className="px-2 pt-1 text-[12px] text-fg-muted">Visible groups</div>
            {groups.filter((g) => !hiddenIds.has(g.id)).map((g) => row(g, false))}
            <div className="px-2 pt-1 text-[12px] text-fg-muted">Hidden groups</div>
            {hidden.map((g) => row(g, true))}
            <div className="mt-1 flex gap-1 border-t border-line pt-1">
              <button type="button" onClick={() => setAll(false)} className="flex-1 rounded-md px-2 py-1 text-[13px] hover:bg-hover">
                Show all groups
              </button>
              <button type="button" onClick={() => setAll(true)} className="flex-1 rounded-md px-2 py-1 text-[13px] hover:bg-hover">
                Hide all groups
              </button>
            </div>
            <label className="flex h-8 items-center justify-between gap-2 px-2 text-[14px]">
              Hide new groups
              <input type="checkbox" checked={!!cfg.hideByDefault} onChange={(e) => setCfg({ hideByDefault: e.target.checked })} />
            </label>
            <label className="flex h-8 items-center justify-between gap-2 px-2 text-[14px]">
              Hide empty groups
              <input type="checkbox" checked={!!cfg.hideEmptyGroups} onChange={(e) => setCfg({ hideEmptyGroups: e.target.checked })} />
            </label>
          </>
        )}
      </div>
    )
  }

  if (page === 'calcs') {
    const calcs = def.calculations ?? []
    return <Calculations back={back('Calculations')} calcs={calcs} choices={choices} structureId={structureId} onChange={(c) => setDef({ calculations: c })} />
  }

  if (only === 'calcs') {
    return (
      <div className="flex w-64 flex-col p-1">
        <Item icon="ph-sigma" onClick={() => setPage('calcs')} trailing={<Icon name="ph-caret-right" size={14} />}>
          Calculations
        </Item>
      </div>
    )
  }

  return (
    <div className="flex w-64 flex-col p-1">
      {layouts && layouts.length > 0 && (
        <>
          <div className="px-2 pt-1 text-[12px] text-fg-muted">Layout</div>
          {layouts.map((l) => (
            <Item
              key={l}
              icon={LAYOUTS[l].icon}
              onClick={() => setDef({ dataViewLayout: l })}
              trailing={def.dataViewLayout === l ? <Icon name="ph-check" size={14} /> : undefined}
            >
              {LAYOUTS[l].label}
            </Item>
          ))}
          <div className="my-1 border-t border-line" />
        </>
      )}
      {extraPages.map((p) => (
        <Item key={p.key} icon={p.icon} onClick={() => setPage(p.key)} trailing={<Icon name="ph-caret-right" size={14} />}>
          {p.label}
        </Item>
      ))}
      <Item icon="ph-rows" onClick={() => setPage('groups')} trailing={<Icon name="ph-caret-right" size={14} />}>
        Groups
      </Item>
      <Item icon="ph-sigma" onClick={() => setPage('calcs')} trailing={<Icon name="ph-caret-right" size={14} />}>
        Calculations
      </Item>
      <Item
        icon="ph-info"
        onClick={() => onState({ ...state, showDataViewDetails: !state.showDataViewDetails })}
      >
        {state.showDataViewDetails ? 'Hide details' : 'Show details'}
      </Item>
    </div>
  )
}

function Calculations({
  back,
  calcs,
  choices,
  structureId,
  onChange,
}: {
  back: ReactNode
  calcs: NonNullable<DataViewDefinition['calculations']>
  choices: PropChoice[]
  structureId?: string
  onChange(next: NonNullable<DataViewDefinition['calculations']>): void
}) {
  const [adding, setAdding] = useState(false)
  const [key, setKey] = useState('')
  const choice = choiceFor(choices, key)
  const kinds = choice ? CALC_KINDS(choice.kind) : []
  return (
    <div className="flex w-64 flex-col p-1">
      {back}
      {calcs.map((c) => (
        <div key={`${c.structureId}-${c.propertyId}`} className="flex h-8 items-center gap-2 px-2 text-[14px]">
          <span className="min-w-0 flex-1 truncate">
            {choiceFor(choices, c.propertyId)?.name ?? c.propertyId}: {CALC_LABELS.full[c.kind] ?? c.kind}
          </span>
          <button
            type="button"
            aria-label="Remove calculation"
            onClick={() => onChange(calcs.filter((x) => x !== c))}
            className="text-fg-muted hover:text-fg"
          >
            <Icon name="ph-x" size={13} />
          </button>
        </div>
      ))}
      {adding ? (
        <div className="flex flex-col gap-1 p-2">
          <select aria-label="Calculation property" value={key} onChange={(e) => setKey(e.target.value)} className={cn(SELECT, 'w-full')}>
            <option value="">Select a property…</option>
            {choices
              .filter((c) => CALC_KINDS(c.kind).length > 0)
              .map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
          </select>
          {choice && (
            <select
              aria-label="Calculation"
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return
                const rest = calcs.filter((c) => c.propertyId !== choice.key)
                onChange([...rest, { propertyId: choice.key, structureId: choice.structureId ?? structureId ?? '', kind: e.target.value }])
                setAdding(false)
                setKey('')
              }}
              className={cn(SELECT, 'w-full')}
            >
              <option value="">Select a calculation…</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {CALC_LABELS.full[k] ?? k}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : (
        <Item icon="ph-plus" onClick={() => setAdding(true)}>
          Add calculation
        </Item>
      )}
    </div>
  )
}
