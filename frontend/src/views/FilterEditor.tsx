// The filter popover's body: nested AND/OR rows, each a property, an operator and a value editor.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '@/api/client'
import { COMPUTED_KINDS } from '@/api/types'
import type { Collection, EntityRef, Filter, FilterGroup, FilterReference, NumberFormat, PropertyDef, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLinkIndex } from '@/links/linkIndex'
import { cn } from '@/lib/utils'
import { zonedToday } from '@/lib/zonedTime'
import { DatePicker } from '@/properties/DatePicker'
import { computedNumberFormat } from '@/properties/computed'
import { parseNumberInput, usesRadixComma } from '@/properties/format'
import { LabelPill } from '@/properties/LabelMenu'
import { RelationPicker } from '@/properties/RelationPicker'
import { DATE_RELATIVE_OPTIONS } from './dates'
import { computedOperand, filterIsValid, filterOptionsFor, withOperator } from './filter'
import { MenuSelect, propertyOptions } from './MenuSelect'
import { choiceFor, type PropChoice } from './properties'

export interface FilterEditorProps {
  group: FilterGroup
  onChange(next: FilterGroup): void
  choices: PropChoice[]
  types: TypeDef[]
  collections: Collection[]
}

/** The filter editor's strings; "Select…" is ours (for an empty picker). */
export const FILTER_TEXT = {
  selectDate: 'Select date',
  oneSelected: '1 element selected',
  elementsSelected: (count: number) => `${count} objects`,
  select: 'Select…',
}

const SELECT = 'h-7 max-w-full rounded-md border border-line bg-raised px-1.5 text-[13px] text-fg outline-none'
const NO_VALUE = new Set(['isEmpty', 'isNotEmpty', 'isChecked', 'isNotChecked', 'startIsNotEmpty', 'endIsEmpty', 'endIsNotEmpty'])

export const emptyGroup = (operator: 'and' | 'or' = 'and', elements: FilterGroup['elements'] = []): FilterGroup => ({
  type: 'filterGroup',
  operator,
  elements,
})

/** A fresh filter on the first operator of `choice`. */
export function newFilter(choice: PropChoice): Filter {
  const first = filterOptionsFor(choice.def)[0]
  return {
    type: 'filter',
    propertyId: choice.key,
    option: first?.key ?? 'isEmpty',
    ...(choice.typeId ? { typeId: choice.typeId } : {}),
  }
}

const eligible = (choices: PropChoice[]) => choices.filter((c) => filterOptionsFor(c.def).length > 0)

export function FilterEditor(props: FilterEditorProps) {
  const { group, onChange, choices } = props
  const usable = eligible(choices)
  const add = () => usable[0] && onChange({ ...group, elements: [...group.elements, newFilter(usable[0])] })
  const addGroup = () =>
    usable[0] &&
    onChange({
      ...group,
      elements: [
        ...group.elements,
        emptyGroup(group.operator === 'and' ? 'or' : 'and', [newFilter(usable[0]), newFilter(usable[0])]),
      ],
    })
  return (
    <div className="flex w-[34rem] max-w-full flex-col gap-1.5 p-2 text-[13px]">
      <Rows {...props} depth={0} />
      {usable.length === 0 ? (
        <p className="px-1 text-fg-muted">No properties can be filtered here</p>
      ) : (
        <div className="flex gap-1">
          <button type="button" onClick={add} className="flex items-center gap-1 rounded-md px-2 py-1 text-fg-muted hover:bg-hover">
            + Filter
          </button>
          <button
            type="button"
            onClick={addGroup}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-fg-muted hover:bg-hover"
          >
            + Filter group
          </button>
        </div>
      )}
    </div>
  )
}

function Rows({ group, onChange, choices, types, collections, depth }: FilterEditorProps & { depth: number }) {
  const typesById = useMemo(() => Object.fromEntries(types.map((t) => [t.id, t])), [types])
  const setAt = (i: number, el: Filter | FilterGroup | null) => {
    const elements = group.elements.flatMap((e, j) => (j === i ? (el ? [el] : []) : [e]))
    onChange({ ...group, elements })
  }
  const lead = (i: number): ReactNode => {
    if (i === 0) return <span className="w-14 shrink-0 py-1 text-fg-muted">where</span>
    if (i === 1)
      return (
        <MenuSelect
          label="Group operator"
          value={group.operator}
          onChange={(v) => onChange({ ...group, operator: v as 'and' | 'or' })}
          options={[
            { value: 'and', label: 'and' },
            { value: 'or', label: 'or' },
          ]}
          className="w-14 shrink-0"
        />
      )
    return (
      <span data-testid="group-operator" className="w-14 shrink-0 px-1.5 py-1 text-fg-muted">
        {group.operator}
      </span>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      {group.elements.map((el, i) => (
        <div key={i} className="flex items-start gap-1.5">
          {lead(i)}
          {el.type === 'filter' ? (
            <FilterRow
              filter={el}
              choices={choices}
              typesById={typesById}
              collections={collections}
              onChange={(f) => setAt(i, f)}
              menu={
                depth <= 1 ? (
                  <RowMenu
                    items={[
                      ...(depth === 0
                        ? [
                            {
                              label: 'Turn into group',
                              run: () => setAt(i, emptyGroup(group.operator === 'and' ? 'or' : 'and', [el])),
                            },
                          ]
                        : []),
                      { label: 'Remove', run: () => setAt(i, null) },
                    ]}
                  />
                ) : null
              }
            />
          ) : (
            <div data-testid="filter-group" className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-md border border-line p-1.5">
              <div className="flex items-center justify-between">
                <span className="text-fg-muted">Filter group</span>
                <RowMenu
                  items={[
                    {
                      label: 'Ungroup',
                      run: () => {
                        const elements = group.elements.flatMap((e, j) => (j === i ? el.elements : [e]))
                        onChange({ ...group, elements })
                      },
                    },
                    { label: 'Remove', run: () => setAt(i, null) },
                  ]}
                />
              </div>
              <Rows
                group={el}
                choices={choices}
                types={types}
                collections={collections}
                depth={depth + 1}
                // Removing the last filter of a nested group ungroups it, which leaves nothing behind.
                onChange={(next) => setAt(i, next.elements.length === 0 ? null : next)}
              />
              <button
                type="button"
                onClick={() => {
                  const first = eligible(choices)[0]
                  if (first) setAt(i, { ...el, elements: [...el.elements, newFilter(first)] })
                }}
                className="flex w-fit items-center gap-1 rounded-md px-2 py-1 text-fg-muted hover:bg-hover"
              >
                + Filter
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function RowMenu({ items }: { items: { label: string; run(): void }[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Filter options"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover"
        >
          <Icon name="ph-dots-three-bold" size={15} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 border-line bg-raised p-1">
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            onClick={() => {
              setOpen(false)
              it.run()
            }}
            className="flex w-full items-center rounded px-2 py-1 text-left text-[14px] hover:bg-hover"
          >
            {it.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function FilterRow({
  filter,
  choices,
  typesById,
  collections,
  onChange,
  menu,
}: {
  filter: Filter
  choices: PropChoice[]
  typesById: Record<string, TypeDef>
  collections: Collection[]
  onChange(next: Filter): void
  menu: ReactNode
}) {
  const valid = filterIsValid(filter, typesById)
  const choice = choiceFor(choices, filter.propertyId)
  const options = choice ? filterOptionsFor(choice.def) : []
  const setProperty = (key: string) => {
    const c = choiceFor(choices, key)
    if (c) onChange(newFilter(c))
  }
  const optionOk = options.some((o) => o.key === filter.option)
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      <MenuSelect
        label="Property"
        value={choice ? filter.propertyId : ''}
        onChange={setProperty}
        options={propertyOptions(eligible(choices))}
        placeholder="Invalid"
        className="min-w-[7rem]"
      />
      {choice && options.length > 0 && (
        <MenuSelect
          label="Operator"
          value={optionOk ? filter.option : ''}
          onChange={(v) => onChange(withOperator(filter, v, choice.kind))}
          options={options.map((o) => ({ value: o.key, label: o.label }))}
          placeholder="Invalid"
        />
      )}
      {valid && choice && !NO_VALUE.has(filter.option) && (
        <ValueEditor filter={filter} choice={choice} collections={collections} types={Object.values(typesById)} onChange={onChange} />
      )}
      {!valid && (
        <span className="text-[12px] text-destructive">
          Invalid <span className="text-fg-muted">Will be ignored</span>
        </span>
      )}
      {menu && <span className="ml-auto">{menu}</span>}
    </div>
  )
}

/**
 * M14: one filter on a fixed property, without the property picker: its operator and value
 * editor (the rule editor's "changes to"). The value row is the filter editor's own.
 */
export function FilterValueRow({
  filter,
  choice,
  types,
  collections,
  onChange,
}: {
  filter: Filter
  choice: PropChoice
  types: TypeDef[]
  collections: Collection[]
  onChange(next: Filter): void
}) {
  const options = filterOptionsFor(choice.def)
  const optionOk = options.some((o) => o.key === filter.option)
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-[13px]">
      {options.length > 0 && (
        <MenuSelect
          label="Operator"
          value={optionOk ? filter.option : ''}
          onChange={(v) => onChange({ ...filter, option: v })}
          options={options.map((o) => ({ value: o.key, label: o.label }))}
          placeholder="Invalid"
        />
      )}
      {optionOk && !NO_VALUE.has(filter.option) && (
        <ValueEditor filter={filter} choice={choice} collections={collections} types={types} onChange={onChange} />
      )}
    </div>
  )
}

/** `n` times 10^`by`, without the binary rounding of a multiplication (0.143 → 14.3). */
function shift(n: number, by: number): number {
  const [mantissa, exp] = String(n).split('e')
  return Number(`${mantissa}e${Number(exp ?? 0) + by}`)
}

/** A number still being typed: `-`, `+`, `.`, `1e`, `1e-` (either decimal separator). */
const NUMBER_PREFIX = /^\s*[-+]?[\d.,]*(e[-+]?)?\s*$/i

/**
 * A filter's number, read as the number cells read theirs (`parseNumberInput`: the "Decimal
 * separator" setting, a leading `+`, nothing that isn't finite). The text is kept as typed: a
 * complete number applies at once, an empty field clears the value, and a number still being
 * typed (`-`, `1.`, `1e`) keeps the last value applied. Leaving the field shows the value applied.
 */
function NumberValue({
  value,
  format,
  onChange,
}: {
  value: number | undefined
  format?: NumberFormat | null
  onChange(next: number | undefined): void
}) {
  const comma = usesRadixComma(format)
  const shown = value === undefined ? '' : comma ? String(value).replace('.', ',') : String(value)
  const [text, setText] = useState(shown)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(shown)
  }, [shown])
  return (
    <input
      aria-label="Value"
      inputMode="decimal"
      value={text}
      aria-invalid={(parseNumberInput(text, format) === undefined && !NUMBER_PREFIX.test(text)) || undefined}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        const raw = e.target.value
        setText(raw)
        const n = parseNumberInput(raw, format)
        if (n === null) onChange(undefined)
        else if (n !== undefined) onChange(n)
      }}
      onBlur={() => {
        focused.current = false
        setText(shown)
      }}
      className={cn(SELECT, 'w-28')}
    />
  )
}

function MultiPick({
  label,
  items,
  value,
  onChange,
}: {
  label: string
  items: { id: string; label: ReactNode; text: string }[]
  value: string[]
  onChange(next: string[]): void
}) {
  const chosen = items.filter((i) => value.includes(i.id))
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className={cn(SELECT, 'flex items-center gap-1')}>
          {chosen.length ? chosen.map((c) => c.text).join(', ') : 'Select…'}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-64 w-56 overflow-y-auto border-line bg-raised p-1">
        {items.length === 0 && <p className="px-2 py-1 text-fg-muted">Nothing to select</p>}
        {items.map((it) => {
          const on = value.includes(it.id)
          return (
            <button
              key={it.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={on}
              onClick={() => onChange(on ? value.filter((v) => v !== it.id) : [...value, it.id])}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[14px] hover:bg-hover"
            >
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {on && <Icon name="ph-check" size={14} />}
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

const TEXT_KINDS = new Set([
  'text',
  'url',
  'color',
  'textBlock',
  'entity_title',
  'entity_description',
  'entity_aliases',
  'entity_icon',
  // M12
  'uniqueId',
  'email',
  'phone',
])

/** M12: the value editor a formula's or rollup's operator takes (by what it compares against). */
const COMPUTED_EDITOR = { text: 'text', number: 'number', date: 'datetimeSimple', none: 'text' } as const
const DATE_KINDS = new Set(['datetime', 'datetimeSimple', 'entity_createdAt', 'entity_lastUpdated'])

function ValueEditor({
  filter,
  choice,
  collections,
  types,
  onChange,
}: {
  filter: Filter
  choice: PropChoice
  collections: Collection[]
  types: TypeDef[]
  onChange(next: Filter): void
}) {
  const objects = useLinkIndex((s) => s.objects)
  const computed = COMPUTED_KINDS.has(choice.kind)
  const kind: string = computed ? COMPUTED_EDITOR[computedOperand(filter.option)] : choice.kind
  const ref = filter.referenceValue
  const set = (referenceValue: FilterReference | undefined) => {
    const rest = { ...filter }
    delete rest.referenceValue
    onChange(referenceValue === undefined ? rest : { ...rest, referenceValue })
  }
  const ids = Array.isArray(ref) ? (ref as string[]) : []

  if (TEXT_KINDS.has(kind)) {
    return (
      <input
        aria-label="Value"
        value={typeof ref === 'string' ? ref : ''}
        onChange={(e) => set(e.target.value)}
        className={cn(SELECT, 'min-w-[8rem] flex-1')}
      />
    )
  }
  if (kind === 'number') {
    // A percentage stores the fraction (0.25): its filter value is typed and shown in percent (25).
    const format = computed ? computedNumberFormat(choice.def) : ((choice.def as PropertyDef).options?.numberFormat ?? null)
    const pct = format?.type === 'percentage'
    return (
      <NumberValue
        value={typeof ref === 'number' ? (pct ? shift(ref, 2) : ref) : undefined}
        format={format}
        onChange={(n) => set(n === undefined ? undefined : pct ? shift(n, -2) : n)}
      />
    )
  }
  if (kind === 'label') {
    const options = (choice.def as PropertyDef).options?.set ?? []
    return (
      <MultiPick
        label="Value"
        value={ids}
        onChange={set}
        items={options.map((o) => ({ id: o.id, text: o.text, label: <LabelPill option={o} /> }))}
      />
    )
  }
  if (kind === 'entity_type') {
    return (
      <MultiPick label="Value" value={ids} onChange={set} items={types.map((t) => ({ id: t.id, text: t.name, label: t.name }))} />
    )
  }
  if (kind === 'entity_collections') {
    return (
      <MultiPick
        label="Value"
        value={ids}
        onChange={set}
        items={collections.map((c) => ({ id: c.id, text: c.name, label: c.name }))}
      />
    )
  }
  if (kind === 'entity' || kind === 'entity_backlinks' || kind === 'entity_tags') {
    const def: PropertyDef =
      kind === 'entity_tags'
        ? ({
            id: 'tags',
            key: 'tags',
            name: 'Tags',
            type: 'entity_tags',
            description: '',
            icon: null,
            visibility: 'alwaysShow',
            options: { allowedTypes: ['tag'], isArray: true },
          } as PropertyDef)
        : (choice.def as PropertyDef)
    const picked: EntityRef[] = ids.flatMap((id) => {
      const o = objects.find((x) => x.id === id)
      return o ? [{ target: o.title, path: o.path }] : []
    })
    const apply = async (refs: EntityRef[]) => {
      const out: string[] = []
      for (const r of refs) {
        if (!r.path) continue
        let id = objects.find((x) => x.path === r.path)?.id ?? null
        if (!id) {
          try {
            id = (await api.ensureId(r.path)).id
          } catch {
            id = null
          }
        }
        if (id) out.push(id)
      }
      set(out)
    }
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Value" className={cn(SELECT, 'flex items-center gap-1')}>
            {picked.length === 1
              ? FILTER_TEXT.oneSelected
              : picked.length > 1
                ? FILTER_TEXT.elementsSelected(picked.length)
                : FILTER_TEXT.select}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto border-line bg-raised p-0">
          <RelationPicker def={def} value={picked} onChange={(refs) => void apply(refs)} />
        </PopoverContent>
      </Popover>
    )
  }
  if (DATE_KINDS.has(kind)) {
    const r = (ref ?? {}) as { relative?: string; exactDate?: string }
    const mode = r.exactDate !== undefined ? 'exactDate' : (r.relative ?? '')
    return (
      <span className="flex items-center gap-1.5">
        <MenuSelect
          label="Date"
          value={mode}
          onChange={(v) => {
            if (v === 'exactDate') set({ exactDate: zonedToday() })
            else if (v) set({ relative: v as never })
          }}
          options={DATE_RELATIVE_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
          placeholder={FILTER_TEXT.selectDate}
        />
        {mode === 'exactDate' && (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" aria-label={FILTER_TEXT.selectDate} className={SELECT}>
                {r.exactDate}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto border-line bg-raised p-0">
              <DatePicker
                value={{ start: r.exactDate ?? '', resolution: 'day' }}
                constraints={{ resolutionConstraint: 'day', endTimeSettings: 'notAllowed' }}
                onChange={(v) => v && set({ exactDate: v.start.slice(0, 10) })}
              />
            </PopoverContent>
          </Popover>
        )}
      </span>
    )
  }
  return null
}
