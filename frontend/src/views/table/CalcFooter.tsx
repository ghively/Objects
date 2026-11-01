// The table's calculation footer: the short label and the value per column; an empty column
// offers "Calculate" on hover. The results are computed once per rows/calculations change.
import { useMemo, useState } from 'react'
import type { PropertyDef, Row, TableColumn, ViewState } from '@/api/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CALC_KINDS, CALC_LABELS, calculate, type CalcResult } from '../calc'
import type { FilterCtx } from '../filter'

export interface CalcFooterProps {
  columns: TableColumn[]
  defs: Record<string, PropertyDef>
  rows: Row[]
  state: ViewState
  onState(next: ViewState): void
  ctx: FilterCtx
  typeId: string
  widths: Record<string, number>
  /** Left offsets (rem) of pinned columns, by column id. */
  sticky: Record<string, number>
}

type CellProps = Pick<CalcFooterProps, 'state' | 'onState' | 'typeId'> & { col: TableColumn; def: PropertyDef; result: CalcResult | null }

function CalcCell({ col, def, result, state, onState, typeId }: CellProps) {
  const [open, setOpen] = useState(false)
  const calcs = state.viewDefinition.calculations ?? []
  const current = calcs.find((c) => c.propertyId === col.id)
  const kinds = CALC_KINDS(def.type)
  const set = (kind: string | null) => {
    const rest = calcs.filter((c) => c.propertyId !== col.id)
    onState({
      ...state,
      viewDefinition: { ...state.viewDefinition, calculations: kind ? [...rest, { propertyId: col.id, structureId: typeId, kind }] : rest },
    })
    setOpen(false)
  }
  if (kinds.length === 0) return null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`calc-${col.id}`}
          className="group/calc flex h-full w-full items-center gap-1.5 px-2 text-left text-[13px] text-fg-muted hover:bg-hover"
        >
          {current && result ? (
            <>
              <span>{CALC_LABELS.short[current.kind] ?? current.kind}</span>
              <span className="text-fg">{result.display}</span>
            </>
          ) : (
            <span className="opacity-0 group-hover/calc:opacity-100">Calculate</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 border-line bg-raised p-1 text-fg">
        {current && (
          <button type="button" onClick={() => set(null)} className="flex h-8 w-full items-center rounded-md px-2 text-left text-[14px] hover:bg-hover">
            None
          </button>
        )}
        {kinds.map((k) => (
          <button key={k} type="button" onClick={() => set(k)} className="flex h-8 w-full items-center rounded-md px-2 text-left text-[14px] hover:bg-hover">
            {CALC_LABELS.full[k] ?? k}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export function CalcFooter({ columns, defs, widths, sticky, rows, ctx, ...rest }: CalcFooterProps) {
  const calcs = rest.state.viewDefinition.calculations
  // One pass over the rows per column with a calculation, redone only when they or the rows change.
  const results = useMemo(() => {
    const out: Record<string, CalcResult> = {}
    for (const c of calcs ?? []) if (defs[c.propertyId]) out[c.propertyId] = calculate(rows, c.propertyId, c.kind, ctx, c.structureId)
    return out
  }, [rows, calcs, defs, ctx])
  return (
    <div role="row" data-testid="calc-footer" className="flex h-8 border-t border-line">
      {columns.map((c) => {
        const def = defs[c.id]
        const left = sticky[c.id]
        return (
          <div
            key={c.id}
            role="cell"
            style={{ width: `${widths[c.id] ?? c.colWidth}rem`, ...(left !== undefined ? { position: 'sticky', left: `${left}rem`, zIndex: 1 } : {}) }}
            className="h-full shrink-0 border-r border-line bg-app"
          >
            {def && <CalcCell col={c} def={def} result={results[c.id] ?? null} {...rest} />}
          </div>
        )
      })}
    </div>
  )
}
