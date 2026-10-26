import type { Sort } from '@/api/types'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { choiceFor, type PropChoice } from './properties'
import { SORT_OPTIONS } from './sort'

const SELECT = 'h-7 max-w-full rounded-md border border-line bg-raised px-1.5 text-[13px] text-fg outline-none'

export interface SortEditorProps {
  sorts: Sort[]
  onChange(next: Sort[]): void
  choices: PropChoice[]
}

const sortable = (choices: PropChoice[]) => choices.filter((c) => SORT_OPTIONS(c.kind).length > 0)

export function SortEditor({ sorts, onChange, choices }: SortEditorProps) {
  const usable = sortable(choices)
  const free = usable.filter((c) => !sorts.some((s) => s.propertyId === c.key))
  const setAt = (i: number, s: Sort | null) => onChange(sorts.flatMap((x, j) => (j === i ? (s ? [s] : []) : [x])))
  const add = () => {
    const c = free[0]
    if (!c) return
    onChange([
      ...sorts,
      { propertyId: c.key, option: SORT_OPTIONS(c.kind)[0].key, ...(c.structureId ? { structureId: c.structureId } : {}) },
    ])
  }
  return (
    <div className="flex w-[22rem] max-w-full flex-col gap-1.5 p-2 text-[13px]">
      {sorts.length === 0 && <p className="px-1 text-fg-muted">No sort</p>}
      {sorts.map((s, i) => {
        const c = choiceFor(choices, s.propertyId)
        const options = c ? SORT_OPTIONS(c.kind) : []
        return (
          <div key={`${s.propertyId}-${i}`} className="flex items-center gap-1.5">
            <select
              aria-label="Sort property"
              value={c ? s.propertyId : ''}
              onChange={(e) => {
                const n = choiceFor(choices, e.target.value)
                if (n)
                  setAt(i, {
                    propertyId: n.key,
                    option: SORT_OPTIONS(n.kind)[0].key,
                    ...(n.structureId ? { structureId: n.structureId } : {}),
                  })
              }}
              className={cn(SELECT, 'min-w-[7rem] flex-1')}
            >
              {!c && <option value="">Invalid</option>}
              {usable
                .filter((u) => u.key === s.propertyId || free.includes(u))
                .map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.name}
                  </option>
                ))}
            </select>
            <select
              aria-label="Sort option"
              value={s.option}
              onChange={(e) => setAt(i, { ...s, option: e.target.value as Sort['option'] })}
              className={SELECT}
            >
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            {i > 0 && (
              <button
                type="button"
                aria-label="Move to top"
                title="Move to top"
                onClick={() => onChange([s, ...sorts.filter((_, j) => j !== i)])}
                className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-hover"
              >
                <Icon name="ph-arrow-line-up" size={14} />
              </button>
            )}
            <button
              type="button"
              aria-label="Remove sort"
              onClick={() => setAt(i, null)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-hover"
            >
              <Icon name="ph-x" size={14} />
            </button>
          </div>
        )
      })}
      {free.length > 0 && (
        <button type="button" onClick={add} className="flex w-fit items-center gap-1 rounded-md px-2 py-1 text-fg-muted hover:bg-hover">
          <Icon name="ph-plus" size={13} />
          Add sort
        </button>
      )}
    </div>
  )
}
