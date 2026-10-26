import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useMemo, useState, type ReactNode } from 'react'
import type { Icon as IconValue, LabelOption, PropertyDef, StatusCategory } from '@/api/types'
import { ColorPicker } from '@/components/ColorPicker'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import { cn } from '@/lib/utils'
import { labelStyle, lineColor, randomColor } from '@/theme/palette'

/** The status sections, in menu order; the first three sit under "Open". */
export const STATUS_SECTIONS: readonly { category: StatusCategory; name: string }[] = [
  { category: 'not-started', name: 'Not started' },
  { category: 'in-progress', name: 'In progress' },
  { category: 'blocked', name: 'Blocked' },
  { category: 'done', name: 'Done' },
]

const MAX_TEXT = 100
const DUPLICATE = 'A label with this name already exists. The name of label has to be unique.'
const SECTION_PREFIX = 'section:'

export interface LabelMenuProps {
  def: PropertyDef
  /** The selected option texts. */
  value: string[]
  onChange(next: string[]): void
  /**
   * Edits to the option set (create, rename, recolour, re-icon, reorder, delete). The parent saves
   * the type; when it returns a promise, a new option's value is applied only after it settles.
   */
  onDefChange(next: PropertyDef): void | Promise<void>
  /** Called after a single-select pick, so the parent can close its popover. */
  onClose?(): void
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `opt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function categoryOf(o: LabelOption): StatusCategory {
  return o.statusCategory ?? 'not-started'
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** `base`, or `base 2`, `base 3`… so that it's unique in `set`. */
function uniqueText(base: string, set: LabelOption[]): string {
  if (!set.some((o) => sameText(o.text, base))) return base
  for (let n = 2; ; n++) {
    const t = `${base} ${n}`
    if (!set.some((o) => sameText(o.text, t))) return t
  }
}

/** A label pill: the option's icon and text in its colour. */
export function LabelPill({ option, className }: { option: Pick<LabelOption, 'text' | 'color' | 'icon'>; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-[1px] text-[13px] leading-5',
        className,
      )}
      style={labelStyle(option.color)}
    >
      {option.icon && <IconOrEmoji icon={option.icon} size={12} />}
      <span className="truncate">{option.text}</span>
    </span>
  )
}

/**
 * The label menu (`w-64`, at most 20rem tall): search, pick, create ("New 'x'"), edit an option
 * ("Edit label": name, colour, icon, delete) and reorder by dragging. On Task's built-in status
 * label the options sit in four sections; dragging an option to another section changes its
 * `statusCategory`, and an empty section offers "Create".
 */
export function LabelMenu({ def, value, onChange, onDefChange, onClose }: LabelMenuProps) {
  const set = useMemo(() => def.options.set ?? [], [def.options.set])
  const multi = def.options.isArray ?? false
  const isStatus = !!def.options.isStatus
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const q = query.trim()
  const searching = q !== ''
  const shown = searching ? set.filter((o) => o.text.toLowerCase().includes(q.toLowerCase())) : set
  const canCreate = searching && !set.some((o) => sameText(o.text, q))

  const withSet = (next: LabelOption[]): PropertyDef => ({ ...def, options: { ...def.options, set: next } })

  const pick = (o: LabelOption) => {
    if (multi) {
      const has = value.includes(o.text)
      onChange(has ? value.filter((v) => v !== o.text) : [...value, o.text])
      return
    }
    onChange(value.length === 1 && value[0] === o.text ? [] : [o.text])
    onClose?.()
  }

  const create = async (text: string, statusCategory?: StatusCategory, select = true) => {
    const option: LabelOption = {
      id: newId(),
      text: text.slice(0, MAX_TEXT),
      color: randomColor(),
      icon: null,
      ...(isStatus ? { statusCategory: statusCategory ?? 'not-started' } : {}),
    }
    await onDefChange(withSet([...set, option]))
    setQuery('')
    if (!select) {
      setEditing(option.id)
      return
    }
    onChange(multi ? [...value, option.text] : [option.text])
    if (!multi) onClose?.()
  }

  const doneCount = set.filter((o) => categoryOf(o) === 'done').length
  const isLastDone = (o: LabelOption) => isStatus && categoryOf(o) === 'done' && doneCount <= 1

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = set.findIndex((o) => o.id === active.id)
    if (from < 0) return
    const moving = set[from]
    const overId = String(over.id)
    const next = set.filter((o) => o.id !== moving.id)
    let category: StatusCategory | undefined
    let at: number
    if (overId.startsWith(SECTION_PREFIX)) {
      // Into a section: after its last option, else at the end.
      const cat = overId.slice(SECTION_PREFIX.length) as StatusCategory
      category = cat
      const last = next.reduce((found, o, i) => (categoryOf(o) === cat ? i : found), -1)
      at = last < 0 ? next.length : last + 1
    } else {
      const target = set.findIndex((o) => o.id === overId)
      if (target < 0) return
      category = isStatus ? categoryOf(set[target]) : undefined
      // As arrayMove: moving down lands after the target, moving up lands before it.
      const inNext = next.findIndex((o) => o.id === overId)
      at = from < target ? inNext + 1 : inNext
    }
    if (isStatus && category && category !== categoryOf(moving) && isLastDone(moving)) return
    const moved = isStatus && category ? { ...moving, statusCategory: category } : moving
    next.splice(at, 0, moved)
    if (next.every((o, i) => o === set[i])) return
    void onDefChange(withSet(next))
  }

  const editingOption = editing ? set.find((o) => o.id === editing) : undefined
  if (editingOption) {
    return (
      <EditLabel
        option={editingOption}
        set={set}
        canDelete={!isLastDone(editingOption)}
        onBack={() => setEditing(null)}
        onSave={(next) => void onDefChange(withSet(set.map((o) => (o.id === next.id ? next : o))))}
        onDelete={() => {
          setEditing(null)
          void onDefChange(withSet(set.filter((o) => o.id !== editingOption.id)))
        }}
      />
    )
  }

  const row = (o: LabelOption) => (
    <OptionRow
      key={o.id}
      option={o}
      selected={value.includes(o.text)}
      sortable={!searching}
      onPick={() => pick(o)}
      onEdit={() => setEditing(o.id)}
    />
  )

  let list: ReactNode
  if (isStatus && !searching) {
    const section = (category: StatusCategory, name: string) => {
      const items = set.filter((o) => categoryOf(o) === category)
      return (
        <StatusSection key={category} category={category} name={name}>
          <SortableContext items={items.map((o) => o.id)} strategy={verticalListSortingStrategy}>
            {items.map(row)}
          </SortableContext>
          {items.length === 0 && (
            <button
              type="button"
              onClick={() => void create(uniqueText('New status', set), category, false)}
              className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
            >
              <Icon name="ph-plus" size={12} />
              Create
            </button>
          )}
        </StatusSection>
      )
    }
    list = (
      <>
        <h3 className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Open</h3>
        {STATUS_SECTIONS.slice(0, 3).map((s) => section(s.category, s.name))}
        {section('done', 'Done')}
      </>
    )
  } else {
    list = (
      <SortableContext items={shown.map((o) => o.id)} strategy={verticalListSortingStrategy}>
        {shown.map(row)}
      </SortableContext>
    )
  }

  return (
    <div className="flex max-h-[20rem] w-64 flex-col">
      <div className="border-b border-line p-1.5">
        <input
          aria-label="Search or create"
          placeholder="Search or create"
          value={query}
          autoFocus
          maxLength={MAX_TEXT}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !q) return
            e.preventDefault()
            const exact = set.find((o) => sameText(o.text, q))
            if (exact) pick(exact)
            else void create(q)
          }}
          className="h-7 w-full rounded bg-transparent px-1.5 text-[14px] text-fg outline-none placeholder:text-fg-muted"
        />
      </div>
      <div role="listbox" aria-multiselectable={multi} aria-label={def.name} className="flex-1 overflow-y-auto p-1">
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          {list}
        </DndContext>
        {canCreate && (
          <button
            type="button"
            onClick={() => void create(q)}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[14px] text-fg hover:bg-hover"
          >
            <Icon name="ph-plus" size={14} />
            {`New '${q}'`}
          </button>
        )}
        {searching && shown.length === 0 && !canCreate && (
          <p className="px-2 py-1 text-[13px] text-fg-muted">No options found</p>
        )}
      </div>
    </div>
  )
}

function StatusSection({
  category,
  name,
  children,
}: {
  category: StatusCategory
  name: string
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${SECTION_PREFIX}${category}` })
  const headingId = `status-${category}`
  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-labelledby={headingId}
      className={cn('rounded py-0.5', isOver && 'bg-hover/50')}
    >
      <h4 id={headingId} className="px-2 py-0.5 text-[12px] text-fg-muted">
        {name}
      </h4>
      {children}
    </div>
  )
}

function OptionRow({
  option,
  selected,
  sortable,
  onPick,
  onEdit,
}: {
  option: LabelOption
  selected: boolean
  sortable: boolean
  onPick(): void
  onEdit(): void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: option.id,
    disabled: !sortable,
  })
  return (
    <div
      ref={setNodeRef}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPick()
        }
      }}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }}
      className={cn(
        'group/opt flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 hover:bg-hover',
        isDragging && 'opacity-60',
      )}
    >
      {sortable && (
        <span
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          onClick={(e) => e.stopPropagation()}
          className="flex h-5 w-4 shrink-0 cursor-grab items-center justify-center text-fg-muted opacity-0 group-hover/opt:opacity-100"
        >
          <Icon name="ph-dots-six-vertical" size={12} />
        </span>
      )}
      <LabelPill option={option} className="min-w-0" />
      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        {selected && (
          <span className="text-fg-muted">
            <Icon name="ph-check" size={14} />
          </span>
        )}
        <button
          type="button"
          aria-label="Edit label"
          title="Edit label"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className="flex h-5 w-5 items-center justify-center rounded text-fg-muted opacity-0 hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover/opt:opacity-100"
        >
          <Icon name="ph-dots-three" size={14} />
        </button>
      </span>
    </div>
  )
}

/** The "Edit label" submenu: name (saved on blur), colour, icon and delete. */
function EditLabel({
  option,
  set,
  canDelete,
  onBack,
  onSave,
  onDelete,
}: {
  option: LabelOption
  set: LabelOption[]
  canDelete: boolean
  onBack(): void
  onSave(next: LabelOption): void
  onDelete(): void
}) {
  const [text, setText] = useState(option.text)
  const [iconOpen, setIconOpen] = useState(false)
  const t = text.trim()
  const duplicate = set.some((o) => o.id !== option.id && sameText(o.text, t))

  const commitName = () => {
    if (!t || duplicate || t === option.text) return
    onSave({ ...option, text: t })
  }

  return (
    <div className="flex w-64 flex-col gap-2 p-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Icon name="ph-caret-left" size={14} />
        </button>
        <span className="text-[13px] text-fg-muted">Edit label</span>
      </div>
      <input
        aria-label="Label name"
        value={text}
        maxLength={MAX_TEXT}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
        className="h-8 rounded-md border border-line bg-panel px-2 text-[14px] text-fg outline-none focus:border-fg-muted"
      />
      {duplicate && (
        <p role="alert" className="text-[12px]" style={{ color: lineColor('red') }}>
          {DUPLICATE}
        </p>
      )}
      <div className="text-[12px] text-fg-muted">Color</div>
      <ColorPicker
        value={option.color}
        onChange={(c) => {
          if (c !== option.color) onSave({ ...option, color: c })
        }}
      />
      <button
        type="button"
        onClick={() => setIconOpen((o) => !o)}
        className="flex items-center gap-2 rounded px-1 py-1 text-left text-[13px] text-fg hover:bg-hover"
      >
        {option.icon ? <IconOrEmoji icon={option.icon} size={14} /> : <Icon name="ph-smiley" size={14} />}
        Icon
      </button>
      {iconOpen && (
        <IconPicker
          value={option.icon}
          onChange={(icon: IconValue | null) => {
            onSave({ ...option, icon })
            if (icon === null || icon.type === 'emoji') setIconOpen(false)
          }}
        />
      )}
      <button
        type="button"
        disabled={!canDelete}
        title={canDelete ? undefined : 'A status label needs at least one Done label.'}
        onClick={onDelete}
        className="flex items-center gap-2 rounded px-1 py-1 text-left text-[13px] text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name="ph-trash" size={14} />
        Delete
      </button>
    </div>
  )
}
