import type { Sort } from '@/api/types'
import { Icon } from '@/components/Icon'
import { MenuSelect, propertyOptions } from './MenuSelect'
import { choiceFor, type PropChoice } from './properties'
import { SORT_OPTIONS } from './sort'

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
      { propertyId: c.key, option: SORT_OPTIONS(c.kind)[0].key, ...(c.typeId ? { typeId: c.typeId } : {}) },
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
            <MenuSelect
              label="Sort property"
              value={c ? s.propertyId : ''}
              onChange={(v) => {
                const n = choiceFor(choices, v)
                if (n)
                  setAt(i, {
                    propertyId: n.key,
                    option: SORT_OPTIONS(n.kind)[0].key,
                    ...(n.typeId ? { typeId: n.typeId } : {}),
                  })
              }}
              options={propertyOptions(usable.filter((u) => u.key === s.propertyId || free.includes(u)))}
              placeholder="Invalid"
              className="min-w-[7rem] flex-1"
            />
            <MenuSelect
              label="Sort option"
              value={s.option}
              onChange={(v) => setAt(i, { ...s, option: v as Sort['option'] })}
              options={options.map((o) => ({ value: o.key, label: o.label }))}
            />
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
