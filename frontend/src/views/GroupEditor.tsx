import type { GroupBy, GroupByEntry, GroupSortOption } from '@/api/types'
import { cn } from '@/lib/utils'
import { GROUP_OPTIONS, GROUP_SORT_OPTIONS, isGroupable } from './group'
import { choiceFor, type PropChoice } from './properties'

const SELECT = 'h-7 max-w-full rounded-md border border-line bg-raised px-1.5 text-[13px] text-fg outline-none'

export interface GroupEditorProps {
  groupBy: GroupBy | null
  onChange(next: GroupBy | null): void
  choices: PropChoice[]
}

export function GroupEditor({ groupBy, onChange, choices }: GroupEditorProps) {
  const entry = groupBy?.groups?.[0]
  const choice = entry ? choiceFor(choices, entry.propertyId) : undefined
  const options = choice ? GROUP_OPTIONS(choice.kind) : []
  const sortOptions = choice ? GROUP_SORT_OPTIONS(choice.kind) : []

  const setEntry = (next: GroupByEntry) => onChange({ ...(groupBy ?? {}), groups: [next] })
  const range = entry?.numberRangeConfig ?? {}
  const setRange = (k: 'min' | 'max' | 'step', v: string) => {
    if (!entry) return
    const n = { ...range }
    if (v === '' || Number.isNaN(Number(v))) delete n[k]
    else n[k] = Number(v)
    setEntry({ ...entry, numberRangeConfig: n })
  }

  return (
    <div className="flex w-72 max-w-full flex-col gap-2 p-2 text-[13px]">
      <label className="flex flex-col gap-1">
        <span className="text-fg-muted">Group by</span>
        <select
          aria-label="Group property"
          value={entry && choice ? entry.propertyId : ''}
          onChange={(e) => {
            const c = choiceFor(choices, e.target.value)
            if (!c) return onChange(null)
            // A new property starts with its default option and group order.
            onChange({
              groups: [
                {
                  propertyId: c.key,
                  option: GROUP_OPTIONS(c.kind)[0]?.key ?? 'default',
                  ...(c.structureId ? { structureId: c.structureId } : {}),
                },
              ],
            })
          }}
          className={cn(SELECT, 'w-full')}
        >
          <option value="">None</option>
          {choices
            .filter((c) => isGroupable(c.kind))
            .map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
        </select>
      </label>
      {entry && choice && options.length > 1 && (
        <select
          aria-label="Group option"
          value={entry.option}
          onChange={(e) => setEntry({ ...entry, option: e.target.value })}
          className={cn(SELECT, 'w-full')}
        >
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {entry && choice?.kind === 'number' && entry.option === 'range' && (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-fg-muted">Group range</legend>
          {(
            [
              ['min', 'Min'],
              ['max', 'Max'],
              ['step', 'Group every'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-2">
              <span>{label}</span>
              <input
                aria-label={label}
                type="number"
                value={range[k] ?? ''}
                onChange={(e) => setRange(k, e.target.value)}
                className={cn(SELECT, 'w-24')}
              />
            </label>
          ))}
        </fieldset>
      )}
      {entry && choice && (
        <label className="flex flex-col gap-1">
          <span className="text-fg-muted">Sort groups by</span>
          <select
            aria-label="Sort groups by"
            value={groupBy?.sortOption ?? sortOptions[0]?.key ?? 'default'}
            onChange={(e) => onChange({ groups: groupBy!.groups, sortOption: e.target.value as GroupSortOption })}
            className={cn(SELECT, 'w-full')}
          >
            {sortOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
