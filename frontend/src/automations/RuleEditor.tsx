// The rule editor (M14, contract "Rule editor"): a wide dialog, "New automation" / "Edit
// automation", with the rule's Name, When (the trigger and its fields), Only if (the view filter
// editor over the scope's properties; not for schedules), Then (the actions, drag to reorder) and
// a footer with "Turned on", "Cancel" and "Save". A 422 shows its message above the footer; a
// 409 reloads the rule's revision and asks to save again. Every string here is ours.
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ConflictError } from '@/api/client'
import type {
  AutomationAction,
  AutomationActionKind,
  AutomationRule,
  AutomationScope,
  AutomationTrigger,
  AutomationTriggerKind,
  Collection,
  ObjectSummary,
  PropertyDef,
  TypeDef,
} from '@/api/types'
import { Icon } from '@/components/Icon'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { useLinkIndex } from '@/links/linkIndex'
import { cn } from '@/lib/utils'
import { zonedToday } from '@/lib/zonedTime'
import { cellForDef } from '@/properties/cellFor'
import { kindIcon } from '@/properties/kinds'
import { useTagObjects } from '@/properties/TagPicker'
import { useSettings } from '@/settings/useSettings'
import { CustomRepeatDialog } from '@/tasks/CustomRepeatDialog'
import { RepeatMenu } from '@/tasks/RepeatMenu'
import { formatRepeat, parseRepeat } from '@/tasks/repeat'
import { useDefinitions } from '@/types/useDefinitions'
import { FilterEditor, FilterValueRow, newFilter } from '@/views/FilterEditor'
import { MenuSelect, propertyOptions, type MenuOption } from '@/views/MenuSelect'
import {
  actionKindsFor,
  cleanRule,
  defaultStart,
  isDateKind,
  newAction,
  newRuleInput,
  parseTime,
  ruleInputOf,
  ruleProblem,
  type RuleFields,
  RULE_TEXT,
  scopeChoices,
  scopeTypes,
  showTime,
  triggerOfKind,
  watchableChoices,
  writableDefs,
} from './ruleModel'

export const RULE_EDITOR_TEXT = {
  newTitle: 'New automation',
  editTitle: 'Edit automation',
  description: 'Choose when it runs, which objects it applies to and what it does.',
  name: 'Name',
  namePlaceholder: 'Stamp completion date',
  when: 'When',
  onlyIf: 'Only if',
  onlyIfHelp: 'Leave empty to run every time.',
  then: 'Then',
  addAction: '+ Add action',
  removeAction: 'Remove action',
  drag: 'Drag to reorder',
  turnedOn: 'Turned on',
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving…',
  trigger: 'Trigger',
  scope: 'Objects',
  anyObject: 'Any object',
  property: 'Property',
  toAny: 'to any value',
  to: 'to',
  repeat: 'Repeat',
  time: 'Time',
  start: 'Start date',
  value: 'Value',
  now: 'Now',
  tag: 'Tag',
  collection: 'Collection',
  type: 'Type',
  template: 'Template',
  defaultTemplate: 'Default template',
  noTemplate: 'No template',
  title: 'Title',
  titlePlaceholder: "Empty: the template's title",
  relateVia: 'Relate back through',
  noRelation: "Don't relate",
  text: 'Text',
  notifyTitle: 'Notification title',
  notifyTitlePlaceholder: "Empty: the automation's name",
  notifyBody: 'Notification text',
  placeholders: 'You can use {title} {link} {date:YYYY-MM-DD}',
  choose: 'Choose…',
  conflict: 'This automation was changed elsewhere. Save again to keep your version.',
  schedulesHaveNoConditions: 'Scheduled automations run without an object, so they have no conditions.',
} as const

const T = RULE_EDITOR_TEXT

const FIELD =
  'h-7 rounded-md border border-line bg-raised px-2 text-[13px] text-fg outline-none placeholder:text-fg-muted focus-visible:ring-1 focus-visible:ring-line'

export interface RuleEditorDialogProps {
  open: boolean
  /** The rule to edit; null makes a new one. */
  rule: AutomationRule | null
  /** A new rule's starting fields (a button trigger scoped to a type, from a Button property). */
  initial?: Partial<RuleFields>
  onOpenChange(open: boolean): void
  onSaved?(rule: AutomationRule): void
}

export { ScheduleFields }

export function RuleEditorDialog({ open, rule, initial, onOpenChange, onSaved }: RuleEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(860px,calc(100vh-48px))] w-[min(760px,calc(100vw-32px))] max-w-none flex-col gap-0 border-line bg-raised-2 p-0 text-fg sm:max-w-none"
        // A dialog opened from a table cell or a block: its events stay out of the row's and the editor's handlers.
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {open && <RuleEditorBody rule={rule} initial={initial} onClose={() => onOpenChange(false)} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}

function RuleEditorBody({
  rule,
  initial,
  onClose,
  onSaved,
}: {
  rule: AutomationRule | null
  initial?: Partial<RuleFields>
  onClose(): void
  onSaved?(rule: AutomationRule): void
}) {
  const types = useLinkIndex((s) => s.types)
  const { collections } = useDefinitions()
  const [base, setBase] = useState<AutomationRule | null>(rule)
  const [draft, setDraft] = useState<RuleFields>(() => (rule ? ruleInputOf(rule) : newRuleInput(initial)))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const set = (patch: Partial<RuleFields>) => {
    setError(null)
    setDraft((d) => ({ ...d, ...patch }))
  }

  const save = async () => {
    const clean = cleanRule(draft)
    const problem = ruleProblem(clean)
    if (problem) return setError(problem)
    setSaving(true)
    try {
      let saved: AutomationRule
      if (base) saved = (await api.saveAutomation({ ...base, ...clean }, { baseRevision: base.revision })).rule
      else saved = await api.createAutomation(clean)
      onSaved?.(saved)
      onClose()
    } catch (e) {
      if (e instanceof ConflictError && base) {
        try {
          setBase(await api.automation(base.id))
        } catch {
          // Keep the old revision: the next save answers 409 (or 404) again.
        }
        setError(T.conflict)
      } else setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const trigger = draft.trigger
  const scope: AutomationScope | null = 'scope' in trigger ? trigger.scope : null
  const isSchedule = trigger.kind === 'schedule'
  const choices = useMemo(() => scopeChoices(scope, types, collections), [scope, types, collections])
  const scopedTypes = useMemo(() => scopeTypes(scope, types, collections), [scope, types, collections])

  return (
    <>
      <div className="border-b border-line px-6 pt-5 pb-4">
        <DialogTitle className="text-[18px] font-semibold">{base ? T.editTitle : T.newTitle}</DialogTitle>
        <DialogDescription className="text-[13px] text-fg-muted">{T.description}</DialogDescription>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-4">
        <Section title={T.name}>
          <input
            aria-label={T.name}
            value={draft.name}
            maxLength={100}
            placeholder={T.namePlaceholder}
            onChange={(e) => set({ name: e.target.value })}
            className={cn(FIELD, 'h-8 w-full text-[14px]')}
          />
        </Section>
        <Section title={T.when}>
          <TriggerEditor trigger={trigger} types={types} collections={collections} onChange={(t) => set({ trigger: t })} />
        </Section>
        <Section title={T.onlyIf} help={isSchedule ? T.schedulesHaveNoConditions : T.onlyIfHelp}>
          {!isSchedule && (
            <div className="-mx-2">
              <FilterEditor
                group={draft.conditions}
                onChange={(conditions) => set({ conditions })}
                choices={choices}
                types={types}
                collections={collections}
              />
            </div>
          )}
        </Section>
        <Section title={T.then}>
          <ActionList
            actions={draft.actions}
            triggerKind={trigger.kind}
            scopedTypes={scopedTypes}
            types={types}
            collections={collections}
            onChange={(actions) => set({ actions })}
          />
        </Section>
      </div>
      <div className="border-t border-line px-6 py-3">
        {error && (
          <p role="alert" className="pb-2 text-[13px] text-[var(--danger)]">
            {error}
          </p>
        )}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-[14px]">
            <Switch aria-label={T.turnedOn} checked={draft.enabled} onCheckedChange={(v) => set({ enabled: v === true })} />
            {T.turnedOn}
          </label>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="h-8 rounded-md px-3 text-[14px] hover:bg-hover">
            {T.cancel}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="h-8 rounded-md bg-primary-btn px-3 text-[14px] font-medium text-app hover:opacity-90 disabled:opacity-50"
          >
            {saving ? T.saving : T.save}
          </button>
        </div>
      </div>
    </>
  )
}

function Section({ title, help, children }: { title: string; help?: string; children?: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div>
        <h3 className="text-[14px] font-semibold">{title}</h3>
        {help && <p className="text-[12px] text-fg-muted">{help}</p>}
      </div>
      {children}
    </section>
  )
}

// ---- When ----

const TRIGGER_KINDS: AutomationTriggerKind[] = ['objectCreated', 'propertyChanged', 'schedule', 'button']

/** Scope picker values: `type:<id>`, `collection:<id>`, or `any` (a button's "Any object"). */
const scopeValue = (s: AutomationScope | null) => (s ? `${s.kind}:${s.id}` : 'any')

function scopeOptions(types: readonly TypeDef[], collections: readonly Collection[], withAny: boolean): MenuOption[] {
  return [
    ...(withAny ? [{ value: 'any', label: T.anyObject, icon: 'ph-asterisk' }] : []),
    ...types.map((t) => ({ value: `type:${t.id}`, label: t.name, icon: t.icon ?? 'ph-file-text' })),
    ...collections.map((c) => ({ value: `collection:${c.id}`, label: c.name, icon: c.icon ?? 'ph-stack' })),
  ]
}

function parseScope(value: string): AutomationScope | null {
  if (value === 'any') return null
  const at = value.indexOf(':')
  return { kind: value.slice(0, at) as AutomationScope['kind'], id: value.slice(at + 1) }
}

function TriggerEditor({
  trigger,
  types,
  collections,
  onChange,
}: {
  trigger: AutomationTrigger
  types: TypeDef[]
  collections: Collection[]
  onChange(next: AutomationTrigger): void
}) {
  const fallback: AutomationScope | null = types[0] ? { kind: 'type', id: types[0].id } : null
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <MenuSelect
          label={T.trigger}
          value={trigger.kind}
          onChange={(k) => k !== trigger.kind && onChange(triggerOfKind(k as AutomationTriggerKind, trigger, fallback, zonedToday()))}
          options={TRIGGER_KINDS.map((k) => ({ value: k, label: RULE_TEXT.triggers[k] }))}
          className="min-w-[12rem]"
        />
        {trigger.kind !== 'schedule' && (
          <MenuSelect
            label={T.scope}
            value={scopeValue(trigger.scope)}
            onChange={(v) => {
              const scope = parseScope(v)
              if (trigger.kind === 'button') onChange({ ...trigger, scope })
              else if (scope && trigger.kind === 'propertyChanged') onChange({ ...trigger, scope, propertyKey: '', to: null })
              else if (scope) onChange({ ...trigger, scope })
            }}
            options={scopeOptions(types, collections, trigger.kind === 'button')}
            placeholder={T.choose}
            className="min-w-[10rem]"
          />
        )}
      </div>
      {trigger.kind === 'propertyChanged' && <PropertyChangeFields trigger={trigger} types={types} collections={collections} onChange={onChange} />}
      {trigger.kind === 'schedule' && <ScheduleFields trigger={trigger} onChange={onChange} />}
    </div>
  )
}

function PropertyChangeFields({
  trigger,
  types,
  collections,
  onChange,
}: {
  trigger: Extract<AutomationTrigger, { kind: 'propertyChanged' }>
  types: TypeDef[]
  collections: Collection[]
  onChange(next: AutomationTrigger): void
}) {
  const choices = watchableChoices(scopeChoices(trigger.scope, types, collections))
  const choice = choices.find((c) => c.key === trigger.propertyKey)
  return (
    <div className="flex flex-wrap items-start gap-1.5">
      <MenuSelect
        label={T.property}
        value={choice ? trigger.propertyKey : ''}
        onChange={(key) => onChange({ ...trigger, propertyKey: key, to: null })}
        options={propertyOptions(choices)}
        placeholder={T.choose}
        className="min-w-[8rem]"
      />
      {choice && (
        <MenuSelect
          label="Changes"
          value={trigger.to ? 'to' : 'any'}
          onChange={(v) => onChange({ ...trigger, to: v === 'to' ? newFilter(choice) : null })}
          options={[
            { value: 'any', label: T.toAny },
            { value: 'to', label: T.to },
          ]}
        />
      )}
      {choice && trigger.to && (
        <FilterValueRow
          filter={trigger.to}
          choice={choice}
          types={types}
          collections={collections}
          onChange={(to) => onChange({ ...trigger, to: { ...to, propertyId: trigger.propertyKey } })}
        />
      )}
    </div>
  )
}

function ScheduleFields({
  trigger,
  onChange,
}: {
  trigger: Extract<AutomationTrigger, { kind: 'schedule' }>
  onChange(next: AutomationTrigger): void
}) {
  const twentyFour = useSettings((s) => s.settings.twentyFourHourTime)
  const [custom, setCustom] = useState(false)
  const [timeText, setTimeText] = useState(showTime(trigger.time, twentyFour))
  useEffect(() => setTimeText(showTime(trigger.time, twentyFour)), [trigger.time, twentyFour])
  const setRepeat = (repeat: string | null) => {
    if (!repeat) return
    onChange({ ...trigger, repeat, start: defaultStart(repeat, zonedToday()) })
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="w-full max-w-[22rem] rounded-md border border-line">
        {custom ? (
          <CustomRepeatDialog
            dueDateOnly
            initial={parseRepeat(trigger.repeat)}
            day={trigger.start}
            onCancel={() => setCustom(false)}
            onSave={(r) => {
              setCustom(false)
              setRepeat(formatRepeat({ ...r, mode: 'dueDate' }))
            }}
          />
        ) : (
          <RepeatMenu required value={trigger.repeat || null} date={trigger.start} onChange={setRepeat} onCustom={() => setCustom(true)} />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5">
          <span className="text-fg-muted">{T.time}</span>
          <input
            aria-label={T.time}
            value={timeText}
            placeholder={twentyFour ? '09:00' : '9:00 AM'}
            onChange={(e) => setTimeText(e.target.value)}
            onBlur={() => {
              const t = parseTime(timeText)
              if (t) onChange({ ...trigger, time: t })
              else setTimeText(showTime(trigger.time, twentyFour))
            }}
            className={cn(FIELD, 'w-24')}
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-fg-muted">{T.start}</span>
          <input
            type="date"
            aria-label={T.start}
            value={trigger.start}
            onChange={(e) => e.target.value && onChange({ ...trigger, start: e.target.value })}
            className={FIELD}
          />
        </label>
      </div>
    </div>
  )
}

// ---- Then ----

function ActionList({
  actions,
  triggerKind,
  scopedTypes,
  types,
  collections,
  onChange,
}: {
  actions: AutomationAction[]
  triggerKind: AutomationTriggerKind
  scopedTypes: TypeDef[]
  types: TypeDef[]
  collections: Collection[]
  onChange(next: AutomationAction[]): void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  // Stable ids for the sortable rows while the dialog is open.
  const [ids, setIds] = useState<string[]>(() => actions.map((_, i) => `a${i}`))
  const [nextId, setNextId] = useState(actions.length)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const rowIds = ids.length === actions.length ? ids : actions.map((_, i) => `a${i}`)
  const kinds = actionKindsFor(triggerKind)
  const shown = actions.map((a, i) => ({ a, i })).filter(({ a }) => kinds.includes(a.kind))

  const add = (kind: AutomationActionKind) => {
    setMenuOpen(false)
    onChange([...actions, newAction(kind)])
    setIds([...rowIds, `a${nextId}`])
    setNextId(nextId + 1)
  }
  const setAt = (i: number, next: AutomationAction) => onChange(actions.map((a, j) => (j === i ? next : a)))
  const removeAt = (i: number) => {
    onChange(actions.filter((_, j) => j !== i))
    setIds(rowIds.filter((_, j) => j !== i))
  }
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = rowIds.indexOf(String(active.id))
    const to = rowIds.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onChange(arrayMove(actions, from, to))
    setIds(arrayMove(rowIds, from, to))
  }

  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={shown.map(({ i }) => rowIds[i])} strategy={verticalListSortingStrategy}>
          <ol aria-label={T.then} className="flex flex-col gap-1.5">
            {shown.map(({ a, i }) => (
              <ActionRow key={rowIds[i]} id={rowIds[i]} onRemove={() => removeAt(i)} label={RULE_TEXT.actions[a.kind]}>
                <ActionFields action={a} scopedTypes={scopedTypes} types={types} collections={collections} onChange={(n) => setAt(i, n)} />
              </ActionRow>
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="flex w-fit items-center gap-1 rounded-md px-2 py-1 text-fg-muted hover:bg-hover hover:text-fg">
            {T.addAction}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" role="menu" aria-label={T.addAction} className="w-56 border-line bg-raised p-1">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              role="menuitem"
              onClick={() => add(k)}
              className="flex w-full items-center rounded px-2 py-1 text-left text-[14px] hover:bg-hover"
            >
              {RULE_TEXT.actions[k]}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  )
}

function ActionRow({ id, label, onRemove, children }: { id: string; label: string; onRemove(): void; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <li
      ref={setNodeRef}
      aria-label={label}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }}
      className={cn('group/act flex items-start gap-2 rounded-lg border border-line bg-raised px-2 py-2', isDragging && 'opacity-60')}
    >
      <span
        {...attributes}
        {...listeners}
        aria-label={T.drag}
        className="mt-1 flex h-5 w-4 shrink-0 cursor-grab items-center justify-center text-fg-muted"
      >
        <Icon name="ph-dots-six-vertical" size={13} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="font-medium">{label}</span>
        {children}
      </div>
      <button
        type="button"
        aria-label={T.removeAction}
        title={T.removeAction}
        onClick={onRemove}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
      >
        <Icon name="ph-x" size={14} />
      </button>
    </li>
  )
}

function defOptions(defs: PropertyDef[]): MenuOption[] {
  return defs.map((d) => ({ value: d.key, label: d.name, icon: d.icon ?? kindIcon(d.type) }))
}

function ActionFields({
  action,
  scopedTypes,
  types,
  collections,
  onChange,
}: {
  action: AutomationAction
  scopedTypes: TypeDef[]
  types: TypeDef[]
  collections: Collection[]
  onChange(next: AutomationAction): void
}) {
  switch (action.kind) {
    case 'setProperty':
    case 'clearProperty': {
      const defs = writableDefs(scopedTypes)
      const def = defs.find((d) => d.key === action.key)
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <MenuSelect
            label={T.property}
            value={def ? action.key : ''}
            onChange={(key) => onChange(action.kind === 'setProperty' ? { kind: 'setProperty', key, value: null } : { kind: 'clearProperty', key })}
            options={defOptions(defs)}
            placeholder={T.choose}
            className="min-w-[8rem]"
          />
          {action.kind === 'setProperty' && def && <ValueField action={action} def={def} onChange={onChange} />}
        </div>
      )
    }
    case 'addTag':
    case 'removeTag':
      return <TagField value={action.tagId} onChange={(tagId) => onChange({ ...action, tagId })} />
    case 'addToCollection':
    case 'removeFromCollection':
      return (
        <MenuSelect
          label={T.collection}
          value={action.collectionId}
          onChange={(collectionId) => onChange({ ...action, collectionId })}
          options={collections.map((c) => ({ value: c.id, label: c.name, icon: c.icon ?? 'ph-stack' }))}
          placeholder={T.choose}
          className="w-fit min-w-[10rem]"
        />
      )
    case 'createFromTemplate':
      return <CreateFields action={action} types={types} onChange={onChange} />
    case 'appendToDailyNote':
      return (
        <TextField
          label={T.text}
          multiline
          value={action.text}
          placeholder={T.placeholders}
          onChange={(text) => onChange({ ...action, text })}
        />
      )
    case 'notify':
      return (
        <div className="flex flex-col gap-1.5">
          <TextField
            label={T.notifyTitle}
            value={action.title}
            placeholder={T.notifyTitlePlaceholder}
            onChange={(title) => onChange({ ...action, title })}
          />
          <TextField
            label={T.notifyBody}
            multiline
            value={action.body}
            placeholder={T.placeholders}
            onChange={(body) => onChange({ ...action, body })}
          />
        </div>
      )
  }
}

function TextField({
  label,
  value,
  placeholder,
  multiline,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  multiline?: boolean
  onChange(next: string): void
}) {
  const cls = cn(FIELD, 'w-full')
  return multiline ? (
    <textarea
      aria-label={label}
      value={value}
      placeholder={placeholder}
      rows={2}
      onChange={(e) => onChange(e.target.value)}
      className={cn(cls, 'h-auto min-h-14 py-1')}
    />
  ) : (
    <input aria-label={label} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cls} />
  )
}

/** "Set a property"'s value: the property's own cell, and "Now" for dates. */
function ValueField({
  action,
  def,
  onChange,
}: {
  action: Extract<AutomationAction, { kind: 'setProperty' }>
  def: PropertyDef
  onChange(next: AutomationAction): void
}) {
  const Cell = cellForDef(def)
  const date = isDateKind(def.type)
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {date && (
        <label className="flex shrink-0 items-center gap-1">
          <input
            type="checkbox"
            checked={!!action.now}
            onChange={(e) => onChange({ kind: 'setProperty', key: action.key, value: null, ...(e.target.checked ? { now: true } : {}) })}
          />
          {T.now}
        </label>
      )}
      {!action.now && Cell && (
        <div aria-label={T.value} role="group" className="min-w-[10rem] flex-1 rounded-md border border-line px-2 py-0.5">
          <Cell def={def} value={action.value ?? null} density="table" onChange={(value: unknown) => onChange({ ...action, value })} />
        </div>
      )}
    </div>
  )
}

/** A Tag object by its frontmatter `id` (a tag without one is given one when picked). */
function TagField({ value, onChange }: { value: string; onChange(next: string): void }) {
  const tags = useTagObjects()
  const key = (t: ObjectSummary) => t.id ?? `path:${t.path}`
  const options = tags.map((t) => ({ value: key(t), label: t.title, icon: 'ph-hash' }))
  const known = tags.some((t) => t.id === value)
  return (
    <MenuSelect
      label={T.tag}
      value={known ? value : ''}
      placeholder={value && !known ? value : T.choose}
      onChange={(v) => {
        if (!v.startsWith('path:')) return onChange(v)
        void api
          .ensureId(v.slice('path:'.length))
          .then((r) => onChange(r.id))
          .catch(() => undefined)
      }}
      options={options}
      className="w-fit min-w-[10rem]"
    />
  )
}

function CreateFields({
  action,
  types,
  onChange,
}: {
  action: Extract<AutomationAction, { kind: 'createFromTemplate' }>
  types: TypeDef[]
  onChange(next: AutomationAction): void
}) {
  const [templates, setTemplates] = useState<ObjectSummary[]>([])
  const type = types.find((t) => t.id === action.typeId)
  useEffect(() => {
    if (!action.typeId) return setTemplates([])
    let alive = true
    api
      .templates(action.typeId)
      .then((ts) => alive && setTemplates(ts ?? []))
      .catch(() => alive && setTemplates([]))
    return () => {
      alive = false
    }
  }, [action.typeId])
  const relations = (type?.propertyDefinitions ?? []).filter((d) => d.type === 'entity')
  const templateOptions: MenuOption[] = [
    { value: '', label: T.defaultTemplate },
    { value: 'none', label: T.noTemplate },
    ...templates.filter((t) => t.id).map((t) => ({ value: t.id as string, label: t.template || t.title, icon: 'ph-file-dashed' })),
  ]
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <MenuSelect
          label={T.type}
          value={action.typeId}
          onChange={(typeId) => onChange({ ...action, typeId, templateId: null, relateVia: null })}
          options={types.map((t) => ({ value: t.id, label: t.name, icon: t.icon ?? 'ph-file-text' }))}
          placeholder={T.choose}
          className="min-w-[8rem]"
        />
        {type && (
          <MenuSelect
            label={T.template}
            value={action.templateId ?? ''}
            onChange={(v) => onChange({ ...action, templateId: v === '' ? null : v })}
            options={templateOptions}
          />
        )}
        {type && relations.length > 0 && (
          <>
            <span className="text-fg-muted">{T.relateVia}</span>
            <MenuSelect
              label={T.relateVia}
              value={action.relateVia ?? ''}
              onChange={(v) => onChange({ ...action, relateVia: v === '' ? null : v })}
              options={[{ value: '', label: T.noRelation }, ...defOptions(relations)]}
            />
          </>
        )}
      </div>
      <TextField
        label={T.title}
        value={action.title}
        placeholder={`${T.titlePlaceholder}. ${T.placeholders}`}
        onChange={(title) => onChange({ ...action, title })}
      />
    </div>
  )
}
