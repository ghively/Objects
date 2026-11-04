/**
 * Object Type Settings, in this order: breadcrumb; icon, name, plural, colour and
 * description; Properties; Templates; Configuration › Page, Card view and linking; Delete Object Type.
 *
 * Every edit saves at once through `useTypeEditor` (text fields 400 ms after the last keystroke,
 * and on blur). A type whose file can't be read shows why and disables every control. The
 * "Calendar" group shows for types with a date property (not Task or DailyNote, whose dates have
 * fixed roles); the DailyNote type gets "Reviewing" instead.
 */
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
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
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Icon as IconValue, PropertyDef, TypeDef, TypeFont } from '@/api/types'
import { ColorPicker } from '@/components/ColorPicker'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useLinkIndex } from '@/links/linkIndex'
import { useTypeEditor } from '@/object/useTypeEditor'
import { AddPropertyMenu, BASIC_TYPE_INFO } from '@/properties/AddPropertyMenu'
import { KIND_META, kindIcon } from '@/properties/kinds'
import { PropertySettings } from '@/properties/PropertySettings'
import { moveProperty } from '@/properties/typeEdits'
import { TypeChip } from '@/shell/Sidebar'
import { CardViewSettings } from './CardViewSettings'
import { isBasicDailyNote } from './dashboardSections'
import { DeleteTypeDialog } from './DeleteTypeDialog'
import { PageLayoutCards } from './PageLayoutCards'
import { TemplateManager, TEMPLATE_TEXT } from './TemplateManager'

export const SAVE_DELAY_MS = 400

export const TYPE_SETTINGS_TEXT = {
  breadcrumb: 'Object Types',
  icon: 'Icon',
  name: 'Name',
  pluralName: 'Plural of name',
  color: 'Color',
  description: 'Description',
  descriptionPlaceholder: 'Your description for this object type',
  properties: 'Properties',
  propertiesExplanation: 'Add, remove, and customize the properties of this object type.',
  addProperty: 'Add Property',
  templates: 'Templates',
  configuration: 'Configuration',
  configurationExplanation: 'Customize how objects of this type look and behave across pages, cards, and the calendar.',
  page: 'Page',
  pageLayout: 'Page layout',
  pageLayoutExplanation: 'Choose a page layout for this object type.',
  font: 'Font',
  fontExplanation: 'Pick a font for this object type.',
  wideLayout: 'Wide layout',
  wideLayoutExplanation:
    'Set the default layout mode for this object type. This will only affect the default page layout and will not make any difference for encyclopedia, profile, or index card designs.',
  coverImageMode: 'Cover image mode',
  coverImageModeExplanation:
    'Choose whether cover images of objects of this type should be displayed as wide or small cover images by default. This setting only applies when the object type has a cover image property.',
  coverDisplay: 'Display of cover image',
  coverDisplayExplanation: 'Set how the cover image should be displayed.',
  calendar: 'Calendar',
  calendarSettings: 'Calendar Settings',
  calendarExplanation:
    'This object type has a date property. It is therefore integrated in the calendar. You can select your preferences here.',
  createFromCalendar: 'Create object from calendar',
  createFromCalendarExplanation:
    'If selected, you will see a button in your calendar allowing you to quickly create an object of this type populated with the date of that day.',
  createShow: 'Show',
  createOnce: 'Show for one per day',
  createHide: 'Hide',
  hideFromSidebar: 'Hide object in calendar sidebar',
  hideFromSidebarExplanation:
    'The calendar sidebar shows objects and events on a day. You can choose to hide all objects of this type from the sidebar.',
  reviewing: 'Reviewing',
  reviewingExplanation: 'Daily notes can be marked as reviewed. Hide this if you do not use reviewing.',
  hideReviewing: 'Hide reviewing',
  deleteHeading: 'Delete Object Type',
  deleteExplanation:
    'Moves the type, all its objects and its templates to the Trash. You can restore them from there for 30 days.',
  deleteAction: 'Delete Object Type',
}

const FONTS: readonly { value: TypeFont; name: string }[] = [
  { value: 'sans-serif', name: 'Sans Serif' },
  { value: 'serif', name: 'Serif' },
  { value: 'monospace', name: 'Monospace' },
]

export interface TypeSettingsProps {
  typeId: string
  /** "Edit Template" and "+ New Template": open the template object. */
  onOpenTemplate?(path: string): void
  /** The breadcrumb's type name: open the type's page. */
  onOpenType?(typeId: string): void
  /** After "Delete Object Type" moved the type to the Trash. */
  onDeleted?(): void
}

/**
 * A text field that saves 400 ms after the last change and on blur. Edits from elsewhere replace
 * the draft only while the field isn't being edited. With `required`, an empty draft is never
 * saved: it waits while the user types and goes back to the saved value on blur.
 */
function useDraft(value: string, commit: (next: string) => void, required = false) {
  const [draft, setDraft] = useState(value)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitRef = useRef(commit)
  // `onChange` keeps it current while typing; the effect below covers outside edits.
  const draftRef = useRef(draft)
  const valueRef = useRef(value)

  useLayoutEffect(() => {
    commitRef.current = commit
    valueRef.current = value
  })

  useEffect(() => {
    if (dirty.current) return
    draftRef.current = value
    setDraft(value)
  }, [value])

  const flush = useCallback(
    (final: boolean) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      if (!dirty.current) return
      if (required && draftRef.current.trim() === '') {
        if (!final) return
        dirty.current = false
        setDraft(valueRef.current)
        return
      }
      dirty.current = false
      commitRef.current(draftRef.current)
    },
    [required],
  )

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const onChange = (next: string) => {
    dirty.current = true
    setDraft(next)
    draftRef.current = next
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => flush(false), SAVE_DELAY_MS)
  }

  return { draft, onChange, onBlur: () => flush(true) }
}

function Section({ title, explanation, children }: { title: string; explanation?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-t border-line pt-6">
      <h2 className="text-[18px] font-semibold">{title}</h2>
      {explanation && <p className="mt-1 text-[14px] text-fg-muted">{explanation}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Field({ label, explanation, children }: { label: string; explanation?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-start sm:gap-6">
      <div className="sm:w-[240px] sm:shrink-0">
        <div className="text-[15px] font-medium">{label}</div>
        {explanation && <p className="mt-0.5 text-[13px] text-fg-muted">{explanation}</p>}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; name: string }[]
  onChange(next: T): void
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-9 w-full max-w-[280px] rounded-md border border-line bg-raised px-2 text-[14px] outline-none disabled:opacity-60"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.name}
        </option>
      ))}
    </select>
  )
}

type CreateInCalendar = 'enabled' | 'createOnce' | 'disabled'

const CREATE_IN_CALENDAR: readonly { value: CreateInCalendar; name: string }[] = [
  { value: 'enabled', name: TYPE_SETTINGS_TEXT.createShow },
  { value: 'createOnce', name: TYPE_SETTINGS_TEXT.createOnce },
  { value: 'disabled', name: TYPE_SETTINGS_TEXT.createHide },
]

const isDateKind = (d: PropertyDef): boolean => d.type === 'datetime' || d.type === 'datetimeSimple'

/** Whether the type gets the "Calendar" group: a date property, and not the basic Task or DailyNote type. */
export function showsCalendarGroup(type: TypeDef): boolean {
  if (type.basic && type.name.toLowerCase() === 'task') return false
  if (isBasicDailyNote(type)) return false
  return type.propertyDefinitions.some(isDateKind)
}

/** `type` with `createInCalendarOption` set; `enabled` is the key's absence. */
export function withCreateInCalendar(type: TypeDef, value: CreateInCalendar): TypeDef {
  const next: TypeDef = { ...type }
  if (value === 'enabled') delete next.createInCalendarOption
  else next.createInCalendarOption = value
  return next
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; name: string }[]
  onChange(next: T): void
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-line p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => value !== o.value && onChange(o.value)}
          className={cn(
            'rounded-md px-2.5 py-1 text-[14px]',
            value === o.value ? 'bg-hover font-medium text-fg' : 'text-fg-muted hover:text-fg',
          )}
        >
          {o.name}
        </button>
      ))}
    </div>
  )
}

const inputClass =
  'h-9 w-full max-w-[420px] rounded-md border border-line bg-transparent px-2 text-[15px] outline-none focus:border-fg-muted disabled:opacity-60'

export function TypeSettings({ typeId, onOpenTemplate, onOpenType, onDeleted }: TypeSettingsProps) {
  const editor = useTypeEditor(typeId)
  const type = editor.type
  const allTypes = useLinkIndex((s) => s.types)
  const [iconOpen, setIconOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  /** Save `patch` onto the newest copy of the type when it is sent (after any earlier save). */
  const patch = useCallback(
    (p: Partial<TypeDef>) => {
      void editor.save((latest) => ({ ...latest, ...p }))
    },
    [editor],
  )

  const name = useDraft(
    type?.name ?? '',
    (v) => v.trim() !== type?.name && patch({ name: v.trim() }),
    true,
  )
  const plural = useDraft(
    type?.pluralName ?? '',
    (v) => v.trim() !== type?.pluralName && patch({ pluralName: v.trim() }),
    true,
  )
  const description = useDraft(type?.description ?? '', (v) => {
    if (v !== (type?.description ?? '')) patch({ description: v })
  })

  if (!type) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <p className="font-semibold">Unknown object type</p>
          <p className="mt-1 text-fg-muted">{typeId}</p>
        </div>
      </div>
    )
  }

  const readOnly = !!type.readOnlyReason
  const basic = type.basic

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const to = type.propertyDefinitions.findIndex((d) => d.id === over.id)
    if (to < 0) return
    void editor.save(moveProperty(type, String(active.id), to))
  }

  return (
    <div className="w-full">
      <header className="flex items-center gap-2.5 border-b border-line px-4 pt-5 pb-4">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[15px]">
          <span className="text-fg-muted">{TYPE_SETTINGS_TEXT.breadcrumb}</span>
          <span className="text-fg-muted">/</span>
          <button
            type="button"
            onClick={() => onOpenType?.(type.id)}
            className="flex items-center gap-1.5 rounded px-1 font-semibold hover:bg-hover"
          >
            <TypeChip type={type} size={22} />
            {type.name}
          </button>
        </nav>
      </header>

      <div className="mx-auto w-full max-w-[900px] px-10 pt-6 pb-16">
        {readOnly && (
          <p role="alert" className="mb-4 rounded-lg border border-line bg-hover/60 p-3 text-[14px]">
            {type.readOnlyReason}
          </p>
        )}
        {editor.error && (
          <p role="alert" className="mb-4 text-[14px] text-red-400">
            {editor.error}
          </p>
        )}

        <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-8">
          <div className="flex flex-col">
            <Field label={TYPE_SETTINGS_TEXT.icon}>
              <Popover open={iconOpen} onOpenChange={setIconOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Type icon"
                    className="flex items-center gap-2 rounded-md p-1 hover:bg-hover disabled:opacity-60"
                  >
                    <TypeChip type={type} size={34} />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto border-line bg-raised p-2 text-fg">
                  <IconPicker
                    value={type.icon}
                    onChange={(next: IconValue | null) => {
                      setIconOpen(false)
                      patch({ icon: next ?? { type: 'iconify', val: 'ph-cube' } })
                    }}
                  />
                </PopoverContent>
              </Popover>
            </Field>
            <Field label={TYPE_SETTINGS_TEXT.name}>
              <input
                aria-label={TYPE_SETTINGS_TEXT.name}
                value={name.draft}
                disabled={basic}
                title={basic ? 'Basic object types cannot be renamed.' : undefined}
                onChange={(e) => name.onChange(e.target.value)}
                onBlur={name.onBlur}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                className={inputClass}
              />
            </Field>
            <Field label={TYPE_SETTINGS_TEXT.pluralName}>
              <input
                aria-label={TYPE_SETTINGS_TEXT.pluralName}
                value={plural.draft}
                disabled={basic}
                onChange={(e) => plural.onChange(e.target.value)}
                onBlur={plural.onBlur}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                className={inputClass}
              />
            </Field>
            <Field label={TYPE_SETTINGS_TEXT.color}>
              <ColorPicker value={type.color} onChange={(c) => c !== type.color && patch({ color: c })} />
            </Field>
            <Field label={TYPE_SETTINGS_TEXT.description}>
              <textarea
                aria-label={TYPE_SETTINGS_TEXT.description}
                value={description.draft}
                placeholder={TYPE_SETTINGS_TEXT.descriptionPlaceholder}
                rows={3}
                onChange={(e) => description.onChange(e.target.value)}
                onBlur={description.onBlur}
                className="w-full max-w-[420px] rounded-md border border-line bg-transparent px-2 py-1.5 text-[15px] outline-none focus:border-fg-muted disabled:opacity-60"
              />
            </Field>
          </div>

          <Section title={TYPE_SETTINGS_TEXT.properties} explanation={TYPE_SETTINGS_TEXT.propertiesExplanation}>
            {basic && (
              <p role="note" className="mb-3 flex items-center gap-2 rounded-lg bg-hover/60 p-3 text-[14px]">
                <Icon name="ph-info" size={16} />
                {BASIC_TYPE_INFO}
              </p>
            )}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={type.propertyDefinitions.map((d) => d.id)} strategy={verticalListSortingStrategy}>
                <ul aria-label={TYPE_SETTINGS_TEXT.properties} className="flex flex-col gap-0.5">
                  {type.propertyDefinitions.map((d) => (
                    <PropertyRow
                      key={d.id}
                      def={d}
                      sortable={!basic && !readOnly}
                      onOpen={() => setSettingsFor(d.id)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
            <Popover open={addOpen} onOpenChange={setAddOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={basic || readOnly}
                  title={basic ? BASIC_TYPE_INFO : undefined}
                  className="mt-2 flex items-center gap-2 rounded-md px-2 py-1 text-[14px] text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <Icon name="ph-plus" size={14} />
                  {TYPE_SETTINGS_TEXT.addProperty}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto border-line bg-raised p-1.5 text-fg">
                <AddPropertyMenu
                  type={type}
                  types={allTypes}
                  onSave={(next) => editor.save(next)}
                  onClose={() => setAddOpen(false)}
                />
              </PopoverContent>
            </Popover>
          </Section>

          <Section title={TYPE_SETTINGS_TEXT.templates} explanation={TEMPLATE_TEXT.explanation}>
            <TemplateManager typeId={type.id} editor={editor} onOpenTemplate={onOpenTemplate} disabled={readOnly} />
          </Section>

          <Section title={TYPE_SETTINGS_TEXT.configuration} explanation={TYPE_SETTINGS_TEXT.configurationExplanation}>
            <section aria-label={TYPE_SETTINGS_TEXT.page}>
              <h3 className="mb-2 text-[15px] font-semibold text-fg-muted">{TYPE_SETTINGS_TEXT.page}</h3>
              <Field label={TYPE_SETTINGS_TEXT.pageLayout} explanation={TYPE_SETTINGS_TEXT.pageLayoutExplanation}>
                <PageLayoutCards
                  value={type.viewDesign}
                  disabled={readOnly}
                  onChange={(viewDesign) => patch({ viewDesign })}
                />
              </Field>
              <Field label={TYPE_SETTINGS_TEXT.font} explanation={TYPE_SETTINGS_TEXT.fontExplanation}>
                <Choice
                  label={TYPE_SETTINGS_TEXT.font}
                  value={type.font ?? 'sans-serif'}
                  options={FONTS}
                  onChange={(font) => patch({ font })}
                />
              </Field>
              <Field label={TYPE_SETTINGS_TEXT.wideLayout} explanation={TYPE_SETTINGS_TEXT.wideLayoutExplanation}>
                <Choice
                  label={TYPE_SETTINGS_TEXT.wideLayout}
                  value={type.wideLayoutMode ? 'wide' : 'normal'}
                  options={[
                    { value: 'normal', name: 'Use normal layout' },
                    { value: 'wide', name: 'Use wide layout' },
                  ]}
                  onChange={(v) => patch({ wideLayoutMode: v === 'wide' })}
                />
              </Field>
              <Field label={TYPE_SETTINGS_TEXT.coverImageMode} explanation={TYPE_SETTINGS_TEXT.coverImageModeExplanation}>
                <Choice
                  label={TYPE_SETTINGS_TEXT.coverImageMode}
                  value={type.wideCoverImage ? 'wide' : 'small'}
                  options={[
                    { value: 'small', name: 'Small cover image' },
                    { value: 'wide', name: 'Wide cover image' },
                  ]}
                  onChange={(v) => patch({ wideCoverImage: v === 'wide' })}
                />
              </Field>
              <Field label={TYPE_SETTINGS_TEXT.coverDisplay} explanation={TYPE_SETTINGS_TEXT.coverDisplayExplanation}>
                <Choice
                  label={TYPE_SETTINGS_TEXT.coverDisplay}
                  value={type.cropCoverImage ? 'cover' : 'contain'}
                  options={[
                    { value: 'cover', name: 'Crop to fill available space' },
                    { value: 'contain', name: 'Display full image' },
                  ]}
                  onChange={(v) => patch({ cropCoverImage: v === 'cover' })}
                />
              </Field>
            </section>
            <div className="mt-6">
              <CardViewSettings typeId={type.id} editor={editor} disabled={readOnly} />
            </div>
            {showsCalendarGroup(type) && (
              <section aria-label={TYPE_SETTINGS_TEXT.calendar} className="mt-6">
                <h3 className="mb-1 text-[15px] font-semibold text-fg-muted">{TYPE_SETTINGS_TEXT.calendar}</h3>
                <div className="text-[15px] font-medium">{TYPE_SETTINGS_TEXT.calendarSettings}</div>
                <p className="mt-0.5 mb-2 text-[13px] text-fg-muted">{TYPE_SETTINGS_TEXT.calendarExplanation}</p>
                <Field label={TYPE_SETTINGS_TEXT.createFromCalendar} explanation={TYPE_SETTINGS_TEXT.createFromCalendarExplanation}>
                  <Segmented
                    label={TYPE_SETTINGS_TEXT.createFromCalendar}
                    value={type.createInCalendarOption ?? 'enabled'}
                    options={CREATE_IN_CALENDAR}
                    onChange={(v) => void editor.save((latest) => withCreateInCalendar(latest, v))}
                  />
                </Field>
                <Field label={TYPE_SETTINGS_TEXT.hideFromSidebar} explanation={TYPE_SETTINGS_TEXT.hideFromSidebarExplanation}>
                  <Switch
                    aria-label={TYPE_SETTINGS_TEXT.hideFromSidebar}
                    checked={!!type.hideFromCalendarSidebar}
                    disabled={readOnly}
                    onCheckedChange={(v) => patch({ hideFromCalendarSidebar: v })}
                  />
                </Field>
              </section>
            )}
            {isBasicDailyNote(type) && (
              <section aria-label={TYPE_SETTINGS_TEXT.reviewing} className="mt-6">
                <h3 className="mb-2 text-[15px] font-semibold text-fg-muted">{TYPE_SETTINGS_TEXT.reviewing}</h3>
                <Field label={TYPE_SETTINGS_TEXT.hideReviewing} explanation={TYPE_SETTINGS_TEXT.reviewingExplanation}>
                  <Switch
                    aria-label={TYPE_SETTINGS_TEXT.hideReviewing}
                    checked={!!type.hideReviewing}
                    disabled={readOnly}
                    onCheckedChange={(v) => patch({ hideReviewing: v })}
                  />
                </Field>
              </section>
            )}
          </Section>

          {!basic && (
            <Section title={TYPE_SETTINGS_TEXT.deleteHeading} explanation={TYPE_SETTINGS_TEXT.deleteExplanation}>
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="flex items-center gap-2 rounded-md border border-red-400/40 px-3 py-1.5 text-[14px] text-red-400 hover:bg-red-400/10 disabled:opacity-50"
              >
                <Icon name="ph-trash" size={14} />
                {TYPE_SETTINGS_TEXT.deleteAction}
              </button>
            </Section>
          )}
        </fieldset>
      </div>

      {settingsFor && (
        <PropertySettings
          typeId={type.id}
          propertyId={settingsFor}
          open
          onOpenChange={(o) => !o && setSettingsFor(null)}
          onOpenProperty={setSettingsFor}
          editor={editor}
        />
      )}
      {!basic && (
        <DeleteTypeDialog type={type} open={deleteOpen} onOpenChange={setDeleteOpen} onDeleted={() => onDeleted?.()} />
      )}
      {editor.dialog}
    </div>
  )
}

function PropertyRow({ def, sortable, onOpen }: { def: PropertyDef; sortable: boolean; onOpen(): void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: def.id,
    disabled: !sortable,
  })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }}
      className={cn('group/prop flex h-10 items-center gap-1 rounded-lg px-1 hover:bg-hover', isDragging && 'opacity-60')}
    >
      {sortable ? (
        <span
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center text-fg-muted opacity-0 group-hover/prop:opacity-100"
        >
          <Icon name="ph-dots-six-vertical" size={13} />
        </span>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Edit ${def.name}`}
        className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left"
      >
        <span className="text-fg-muted">
          <IconOrEmoji icon={def.icon ?? kindIcon(def.type)} size={16} fallback="ph-note-blank" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{def.name}</span>
        <span className="shrink-0 text-[13px] text-fg-muted">{KIND_META[def.type]?.name ?? def.type}</span>
      </button>
    </li>
  )
}
