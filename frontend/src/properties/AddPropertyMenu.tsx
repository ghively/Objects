import { typeLabel } from '@/lib/typeLabel'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { Icon as IconValue, PropertyDef, PropertyOptions, PropertyType, TypeDef } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ADD_PROPERTY_ITEMS, KIND_META, objectSelectTypes, type AddPropertyItem } from './kinds'
import { addProperty, isSystemKind } from './typeEdits'

export const BASIC_TYPE_INFO = 'The properties of basic types are fixed.'

export interface AddPropertyMenuProps {
  type: TypeDef
  /** Every type of the space (for "Object Select"). */
  types: readonly TypeDef[]
  /** Save the type with the new property (`added`). */
  onSave(next: TypeDef, added: PropertyDef): Promise<unknown> | void
  onClose?(): void
}

interface Draft {
  kind: PropertyType
  name: string
  description: string
  icon: IconValue | null
  options?: PropertyOptions
}

type Step = { kind: 'list' } | { kind: 'objectSelect' } | { kind: 'confirmContent' } | { kind: 'form'; draft: Draft }

function defaultIcon(kind: PropertyType): IconValue {
  return { type: 'iconify', val: KIND_META[kind].icon }
}

/** The items the type can still add: system properties it already has are hidden. */
export function addableItems(type: TypeDef): AddPropertyItem[] {
  const has = new Set(type.propertyDefinitions.map((d) => d.type))
  return ADD_PROPERTY_ITEMS.filter((i) => !(isSystemKind(i.type) && has.has(i.type)))
}

/**
 * The keys of a search field over a list (fix pass W8): ArrowDown and ArrowUp move a highlight
 * through the list (stopping at its ends), Enter picks the highlighted row, or the first one when
 * none is highlighted. The focus stays in the field, so typing goes on filtering.
 */
function listKey(e: KeyboardEvent, count: number, active: number | null, setActive: (i: number | null) => void, pick: (i: number) => void) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (count === 0) return
    const next = active === null ? 0 : e.key === 'ArrowDown' ? active + 1 : active - 1
    setActive(Math.max(0, Math.min(count - 1, next)))
  } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
    e.preventDefault()
    const i = active ?? 0
    if (i < count) pick(i)
  }
}

/**
 * "Add Property": pick a kind (or "Link to a type" › a type), then name it and "Create". By mouse
 * or by key: the arrows and Enter in either search field (`listKey`), then the default name is
 * selected in the Name field so typing replaces it (fix pass W8).
 */
export function AddPropertyMenu({ type, types, onSave, onClose }: AddPropertyMenuProps) {
  const [step, setStepState] = useState<Step>({ kind: 'list' })
  const [query, setQueryState] = useState('')
  const [typeQuery, setTypeQueryState] = useState('')
  const [iconOpen, setIconOpen] = useState(false)
  // The row the arrow keys highlighted in the list on screen (kinds or types); none after a new
  // search or a change of step.
  const [active, setActive] = useState<number | null>(null)
  const rowId = useId()
  const listRef = useRef<HTMLDivElement | HTMLUListElement | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const basic = type.basic
  const setStep = (next: Step) => {
    setActive(null)
    setStepState(next)
  }
  const setQuery = (q: string) => {
    setActive(null)
    setQueryState(q)
  }
  const setTypeQuery = (q: string) => {
    setActive(null)
    setTypeQueryState(q)
  }
  const inForm = step.kind === 'form'
  // The Name field opens with its default name selected: the first key replaces it.
  useEffect(() => {
    if (inForm) nameRef.current?.select()
  }, [inForm])
  // Keep the highlighted row in view.
  useEffect(() => {
    if (active === null) return
    const row = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return addableItems(type).filter((i) => !q || i.name.toLowerCase().includes(q))
  }, [type, query])

  const targets = useMemo(() => {
    const q = typeQuery.trim().toLowerCase()
    return objectSelectTypes(types).filter((t) => !q || typeLabel(t).toLowerCase().includes(q))
  }, [types, typeQuery])

  const create = (d: Draft) => {
    const next = addProperty(type, d.kind, {
      name: d.name,
      description: d.description.trim(),
      icon: d.icon,
      options: d.options,
    })
    void onSave(next, next.propertyDefinitions[next.propertyDefinitions.length - 1])
    onClose?.()
  }

  const form = (kind: PropertyType, name = KIND_META[kind].name, options?: PropertyOptions) =>
    setStep({ kind: 'form', draft: { kind, name, description: '', icon: defaultIcon(kind), options } })

  const pick = (item: AddPropertyItem) => {
    if (item.action === 'objectSelect') return setStep({ kind: 'objectSelect' })
    if (isSystemKind(item.type)) {
      return create({ kind: item.type, name: item.name, description: '', icon: defaultIcon(item.type) })
    }
    if (item.type === 'blocks' && type.propertyDefinitions.some((d) => d.type === 'blocks')) {
      return setStep({ kind: 'confirmContent' })
    }
    form(item.type)
  }

  if (step.kind === 'confirmContent') {
    return (
      <div className="w-72 p-1 text-fg" role="alertdialog" aria-label="Add a second content property?">
        <h3 className="text-[15px] font-semibold">Add a second content property?</h3>
        <p className="mt-1 text-[13px] text-fg-muted">
          This type already has a content property, which holds the body of your notes. Add a second one anyway?
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="rounded px-2 py-1 text-[13px] hover:bg-hover" onClick={() => setStep({ kind: 'list' })}>
            Cancel
          </button>
          <button
            type="button"
            className="rounded bg-hover px-2 py-1 text-[13px] font-medium"
            onClick={() => form('blocks')}
          >
            Add another
          </button>
        </div>
      </div>
    )
  }

  if (step.kind === 'form') {
    const d = step.draft
    const set = (patch: Partial<Draft>) => setStep({ kind: 'form', draft: { ...d, ...patch } })
    const submit = () => d.name.trim() && create(d)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        submit()
      }
    }
    return (
      <div className="w-72 text-fg" onKeyDown={onKeyDown}>
        <div className="mb-2 flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Back"
            className="rounded p-1 hover:bg-hover"
            onClick={() => setStep({ kind: 'list' })}
          >
            <Icon name="ph-caret-left" size={13} />
          </button>
          <span className="text-[13px] font-semibold text-fg-muted">{KIND_META[d.kind].name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Popover open={iconOpen} onOpenChange={setIconOpen}>
            <PopoverTrigger asChild>
              <button type="button" aria-label="Icon" className="rounded border border-line p-1.5 hover:bg-hover">
                <IconOrEmoji icon={d.icon ?? defaultIcon(d.kind)} size={15} fallback="ph-note-blank" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto border-line bg-raised p-2 text-fg">
              <IconPicker
                value={d.icon}
                onChange={(icon) => {
                  setIconOpen(false)
                  set({ icon })
                }}
              />
            </PopoverContent>
          </Popover>
          <input
            autoFocus
            ref={nameRef}
            aria-label="Name"
            placeholder="Name"
            value={d.name}
            onChange={(e) => set({ name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault()
                submit()
              }
            }}
            className="min-w-0 flex-1 rounded border border-line bg-transparent px-2 py-1 text-[14px] outline-none"
          />
        </div>
        <textarea
          aria-label="Description"
          placeholder="What is this property for?"
          value={d.description}
          onChange={(e) => set({ description: e.target.value })}
          rows={2}
          className="mt-2 w-full resize-none rounded border border-line bg-transparent px-2 py-1 text-[14px] outline-none"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            disabled={!d.name.trim()}
            onClick={submit}
            className="rounded bg-hover px-3 py-1 text-[13px] font-medium disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    )
  }

  if (step.kind === 'objectSelect') {
    const pickType = (t: TypeDef) => form('entity', typeLabel(t), { isArray: true, allowedTypes: [t.id], hasFixedSet: false, fixedSet: [] })
    return (
      <div className="w-64 text-fg">
        <div className="mb-1 flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Back"
            className="rounded p-1 hover:bg-hover"
            onClick={() => setStep({ kind: 'list' })}
          >
            <Icon name="ph-caret-left" size={13} />
          </button>
          <input
            autoFocus
            value={typeQuery}
            onChange={(e) => setTypeQuery(e.target.value)}
            onKeyDown={(e) => listKey(e, targets.length, active, setActive, (i) => pickType(targets[i]))}
            placeholder="Search types"
            aria-label="Search types"
            aria-activedescendant={active !== null && active < targets.length ? `${rowId}-${active}` : undefined}
            className="min-w-0 flex-1 rounded border border-line bg-transparent px-2 py-1 text-[14px] outline-none"
          />
        </div>
        <ul aria-label="Types" ref={(el) => void (listRef.current = el)} className="max-h-80 overflow-auto">
          {targets.map((t, i) => (
            <li key={t.id}>
              <button
                type="button"
                id={`${rowId}-${i}`}
                aria-label={typeLabel(t)}
                data-active={active === i ? 'true' : undefined}
                onClick={() => pickType(t)}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[14px] hover:bg-hover data-[active=true]:bg-hover"
              >
                <IconOrEmoji icon={t.icon} size={14} fallback="ph-cube" />
                <span className="truncate">{typeLabel(t)}</span>
              </button>
            </li>
          ))}
          {targets.length === 0 && <li className="px-2 py-1 text-[13px] text-fg-muted">Nothing found</li>}
        </ul>
      </div>
    )
  }

  return (
    <div className="w-72 text-fg">
      <div className="px-2 pb-1 text-[13px] font-semibold text-fg-muted">Add Property</div>
      {basic && <p className="px-2 pb-1 text-[13px] text-fg-muted">{BASIC_TYPE_INFO}</p>}
      <input
        autoFocus
        disabled={basic}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => listKey(e, items.length, active, setActive, (n) => pick(items[n]))}
        placeholder="Search Properties"
        aria-label="Search Properties"
        aria-activedescendant={active !== null && active < items.length ? `${rowId}-${active}` : undefined}
        className="mb-1 w-full rounded border border-line bg-transparent px-2 py-1 text-[14px] outline-none"
      />
      <div role="menu" aria-label="Add Property" ref={(el) => void (listRef.current = el)} className="max-h-96 overflow-auto">
        {items.map((i, n) => (
          <button
            key={i.key}
            type="button"
            role="menuitem"
            id={`${rowId}-${n}`}
            aria-label={i.name}
            data-active={active === n ? 'true' : undefined}
            disabled={basic}
            onClick={() => pick(i)}
            className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-hover disabled:opacity-50 data-[active=true]:bg-hover"
          >
            <Icon name={i.icon} size={15} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px]">{i.name}</span>
              {i.description && <span className="block text-[12px] text-fg-muted">{i.description}</span>}
            </span>
            {i.action === 'objectSelect' && <Icon name="ph-caret-right" size={12} className="mt-1" />}
          </button>
        ))}
      </div>
    </div>
  )
}
