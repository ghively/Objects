import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '@/api/client'
import type { DateConstraints, PropertyDef, PropertyOptions, PropertyType, TypeDef } from '@/api/types'
import { ColorPicker } from '@/components/ColorPicker'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { wallClock, zonedInstant } from '@/lib/zonedTime'
import { useLinkIndex } from '@/links/linkIndex'
import { useTypeEditor, type TypeEditor } from '@/object/useTypeEditor'
import { CURRENCIES } from './currencies'
import { KIND_META, objectSelectTypes } from './kinds'
import { LabelMenu } from './LabelMenu'
import { NumberFormatMenu } from './NumberFormatMenu'
import { canChangeVisibility, canDeleteProperty, VISIBILITY_OPTIONS } from './PropertyMenu'
import {
  allowedKindChanges,
  removeProperty,
  setDecimals,
  setNumberFormat,
  setProgress,
  setSeparators,
  updateProperty,
} from './typeEdits'

// Capacities' PropertySettings texts.
const TEXT = {
  heading: 'Property settings',
  explanation: 'Edit name, description, and customize this property.',
  applyExplanation:
    "You've made some changes to the configuration of this property. Applying those changes will enforce these rules to the whole database. Links will get removed if they don't follow the above set of rules. Do you really want to proceed?",
  syncExplanation:
    'Link this property with a property in your linked object type. When you update one property, the other is automatically updated.',
  multiSelectOnly:
    'Synced properties are only available for multi-select properties without a fixed set. You need to change your settings above or in your linked object type to enable synchronization.',
  notAllowed:
    'Property syncing is not available for basic object types. You need to link to your own custom object types above.',
  changeTypeExplanation:
    'When changing the type of your property, a new property of the new type is created and your existing property values are matched as best as possible to the new property. You can afterwards check the result and then delete the deprecated property.',
  changeTypeWarning:
    'Changing the type of a property can lead to data loss as some values might not be compatible with the new type.',
  noTransformations: 'This property type cannot be changed.',
  confirmText: 'I understand the process and know that some data might be lost.',
  deleteDescription: 'Deleting a property will be applied to all objects of this type. This action cannot be reverted.',
  blocksPropertyWarning:
    "A content property generally is the main body of an object. Only if you have several content properties, they will be distinguished with a label. Make sure you don't accidentally delete the main content of your notes!",
  onlyBlocksPropertyWarning:
    'This is the only content property present in this object type. This will delete the main content (body) for all objects of this type.',
  datePickerHeading: 'Settings for dates',
  timeDescription: 'Choose if you want to include time in the date and time picker.',
  timePreferenceDescription: 'Choose if you want to initialize your date.',
  rangePreferenceDescription: 'Choose if you want your date to be initialized as a range.',
  defaultDescription: 'Choose a default start date for the date and time picker.',
  descriptionPlaceholder: 'Give others an idea of what this property means',
  // Our strings: the reference's `hideCalendarEvents` flag has no property-settings label.
  /** Our string (M8): the switch that sets `options.constraints.supportsReminders`. */
  reminders: 'Reminders',
  /** Our string. */
  remindersDescription: 'Allow a reminder on values of this property.',
  hideInCalendar: 'Hide in calendar',
  hideInCalendarDescription: "Values of this property don't show on their days in the calendar.",
}

export interface PropertySettingsProps {
  typeId: string
  propertyId: string
  open: boolean
  onOpenChange(open: boolean): void
  /** Open another property's settings (after "Change property type"). */
  onOpenProperty?(propertyId: string): void
  /** The type editor to save through; without one the dialog uses its own. */
  editor?: TypeEditor
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-t border-line pt-3">
      <h3 className="text-[14px] font-semibold">{title}</h3>
      {description && <p className="mt-0.5 text-[13px] text-fg-muted">{description}</p>}
      <div className="mt-2">{children}</div>
    </section>
  )
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { value: T; name: string }[]
  value: T
  onChange(v: T): void
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded border border-line p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-label={`${label}: ${o.name}`}
          aria-pressed={value === o.value}
          onClick={() => value !== o.value && onChange(o.value)}
          className={cn('rounded px-2 py-0.5 text-[13px]', value === o.value ? 'bg-hover font-medium' : 'text-fg-muted')}
        >
          {o.name}
        </button>
      ))}
    </div>
  )
}

function Choice({ selected, onClick, children }: { selected: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'rounded border border-line px-2 py-0.5 text-[13px]',
        selected ? 'bg-hover font-medium' : 'text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

// -- number ----------------------------------------------------------------------------------

function formatName(def: PropertyDef): string {
  const f = def.options.numberFormat
  if (!f) return 'None'
  if (f.type === 'currency') return CURRENCIES.find((c) => c.code === f.options.currency)?.name ?? 'Currency'
  return f.type.charAt(0).toUpperCase() + f.type.slice(1)
}

function NumberSection({ def, save }: { def: PropertyDef; save(next: PropertyDef): void }) {
  const [open, setOpen] = useState(false)
  const fmt = def.options.numberFormat
  const decimals = fmt?.options.decimals
  const sep = fmt?.options.separators ?? {}
  const progress = fmt?.type === 'progress' ? fmt.options.progress : undefined
  const [steps, setSteps] = useState(String(progress?.steps ?? 10))
  useEffect(() => setSteps(String(progress?.steps ?? 10)), [progress?.steps])
  const d = decimals?.max ?? decimals?.min ?? 0
  return (
    <Section title="Format">
      <div className="flex items-center gap-2">
        <span className="w-28 text-[13px] text-fg-muted">Type</span>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" aria-label="Number format" className="rounded border border-line px-2 py-0.5 text-[13px]">
              {formatName(def)}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto border-line bg-raised p-2 text-fg">
            <NumberFormatMenu
              value={fmt}
              onChange={(c) => {
                setOpen(false)
                save(setNumberFormat(def, c))
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="w-28 text-[13px] text-fg-muted">Decimals</span>
        {decimals ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Fewer decimals"
              disabled={d <= 0}
              onClick={() => save(setDecimals(def, d - 1))}
              className="rounded border border-line px-1.5 text-[13px] disabled:opacity-40"
            >
              −
            </button>
            <span data-decimals className="w-5 text-center text-[13px]">
              {d}
            </span>
            <button
              type="button"
              aria-label="More decimals"
              disabled={d >= 5}
              onClick={() => save(setDecimals(def, d + 1))}
              className="rounded border border-line px-1.5 text-[13px] disabled:opacity-40"
            >
              +
            </button>
            <button
              type="button"
              aria-label="Stop enforcing decimals"
              onClick={() => save(setDecimals(def, null))}
              className="rounded px-1.5 text-[13px] text-fg-muted hover:text-fg"
            >
              ✕
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => save(setDecimals(def, 2))} className="text-[13px] text-fg-muted hover:text-fg">
            + Enforce
          </button>
        )}
      </div>
      {progress && (
        <div className="mt-2">
          <div className="text-[13px] font-medium">Progress</div>
          <label className="mt-1 flex items-center gap-2 text-[13px]">
            <span className="w-28 text-fg-muted">Steps</span>
            <input
              type="number"
              min={1}
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              onBlur={() => {
                const n = Math.round(Number(steps))
                if (Number.isFinite(n) && n >= 1 && n !== progress.steps) save(setProgress(def, { steps: n }))
                else setSteps(String(progress.steps))
              }}
              className="w-20 rounded border border-line bg-transparent px-2 py-0.5 outline-none"
            />
          </label>
          <div className="mt-1 flex items-start gap-2 text-[13px]">
            <span className="w-28 text-fg-muted">Color</span>
            <ColorPicker value={progress.color} onChange={(color) => save(setProgress(def, { color }))} />
          </div>
        </div>
      )}
      <div className="mt-2">
        <div className="text-[13px] font-medium">Separators</div>
        <label className="mt-1 flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={sep.isGroupingThousands ?? true}
            onChange={(e) => save(setSeparators(def, { isGroupingThousands: e.target.checked }))}
          />
          Grouping thousands
        </label>
        <label className="mt-1 flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={sep.isRadixComma ?? false}
            onChange={(e) => save(setSeparators(def, { isRadixComma: e.target.checked }))}
          />
          Separator comma
        </label>
      </div>
    </Section>
  )
}

// -- dates -----------------------------------------------------------------------------------

type Rule = 'optional' | 'required' | 'disallowed'
const RULES: readonly { value: Rule; name: string }[] = [
  { value: 'optional', name: 'Optional' },
  { value: 'required', name: 'Required' },
  { value: 'disallowed', name: 'Disallowed' },
]

function withConstraints(def: PropertyDef, patch: Partial<DateConstraints>): PropertyDef {
  const c: Record<string, unknown> = { ...(def.options.constraints ?? {}), ...patch }
  for (const k of Object.keys(c)) if (c[k] === undefined || c[k] === null) delete c[k]
  return { ...def, options: { ...def.options, constraints: c as DateConstraints } }
}

/** A `datetime-local` value read in the "Time zone" setting's zone; an invalid one is NaN. */
function fromLocalInput(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s)
  return m ? zonedInstant(+m[1], +m[2], +m[3], +m[4], +m[5]) : new Date(NaN)
}

/** `2026-10-30T14:00:00.000Z` → the `datetime-local` value in the "Time zone" setting's zone. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  if (Number.isNaN(new Date(iso).getTime())) return ''
  const d = wallClock(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * The Date section. `taskDate`: the basic Task's `date`, whose reminders M4 keeps on (its picker's
 * Repeat and Reminder rows depend on the constraint), so it shows no Reminders switch (our choice).
 */
function DateSection({ def, save, taskDate }: { def: PropertyDef; save(next: PropertyDef): void; taskDate?: boolean }) {
  const c = def.options.constraints ?? {}
  const time: Rule = c.resolutionConstraint === 'time' ? 'required' : c.resolutionConstraint === 'day' ? 'disallowed' : 'optional'
  const range: Rule = c.endTimeSettings === 'required' ? 'required' : c.endTimeSettings === 'notAllowed' ? 'disallowed' : 'optional'
  const custom = !!c.startTimeDefault || !!c.endTimeDefault
  const setTime = (r: Rule) =>
    save(withConstraints(def, { resolutionConstraint: r === 'required' ? 'time' : r === 'disallowed' ? 'day' : undefined }))
  const setRange = (r: Rule) =>
    save(
      withConstraints(def, {
        endTimeSettings: r === 'required' ? 'required' : r === 'disallowed' ? 'notAllowed' : undefined,
        ...(r === 'disallowed' ? { endTimeDefault: undefined } : {}),
      }),
    )
  return (
    <>
      <h3 className="pt-1 text-[14px] font-semibold">{TEXT.datePickerHeading}</h3>
      <Section title="Time" description={TEXT.timeDescription}>
        <Segmented label="Time" options={RULES} value={time} onChange={setTime} />
        {time === 'optional' && <p className="mt-2 text-[13px] text-fg-muted">{TEXT.timePreferenceDescription}</p>}
        {time === 'optional' && (
          <div className="mt-1 flex gap-1.5" role="group" aria-label="Time preference">
            <Choice
              selected={c.resolutionPreference !== 'time'}
              onClick={() => save(withConstraints(def, { resolutionPreference: 'day' }))}
            >
              As day
            </Choice>
            <Choice
              selected={c.resolutionPreference === 'time'}
              onClick={() => save(withConstraints(def, { resolutionPreference: 'time' }))}
            >
              As day and time
            </Choice>
          </div>
        )}
      </Section>
      <Section title="Range" description="Choose if you want to include a range in the date and time picker.">
        <Segmented label="Range" options={RULES} value={range} onChange={setRange} />
        {range === 'optional' && <p className="mt-2 text-[13px] text-fg-muted">{TEXT.rangePreferenceDescription}</p>}
        {range === 'optional' && (
          <div className="mt-1 flex gap-1.5" role="group" aria-label="Range preference">
            <Choice selected={!c.endTimePreference} onClick={() => save(withConstraints(def, { endTimePreference: false }))}>
              As date
            </Choice>
            <Choice selected={!!c.endTimePreference} onClick={() => save(withConstraints(def, { endTimePreference: true }))}>
              As range
            </Choice>
          </div>
        )}
      </Section>
      <Section title="Default" description={TEXT.defaultDescription}>
        <div className="flex gap-1.5">
          <Choice
            selected={!custom}
            onClick={() => custom && save(withConstraints(def, { startTimeDefault: undefined, endTimeDefault: undefined }))}
          >
            Now
          </Choice>
          <Choice
            selected={custom}
            onClick={() => !custom && save(withConstraints(def, { startTimeDefault: new Date().toISOString() }))}
          >
            Custom
          </Choice>
        </div>
        {custom && (
          <div className="mt-2 space-y-1 text-[13px]">
            <label className="flex items-center gap-2">
              <span className="w-28 text-fg-muted">Start</span>
              <input
                type="datetime-local"
                aria-label="Default start"
                defaultValue={toLocalInput(c.startTimeDefault)}
                onBlur={(e) => {
                  const d = fromLocalInput(e.target.value)
                  if (!Number.isNaN(d.getTime())) save(withConstraints(def, { startTimeDefault: d.toISOString() }))
                }}
                className="rounded border border-line bg-transparent px-2 py-0.5"
              />
            </label>
            {range !== 'disallowed' && (
              <label className="flex items-center gap-2">
                <span className="w-28 text-fg-muted">End</span>
                <input
                  type="datetime-local"
                  aria-label="Default end"
                  defaultValue={toLocalInput(c.endTimeDefault)}
                  onBlur={(e) => {
                    const d = fromLocalInput(e.target.value)
                    save(withConstraints(def, { endTimeDefault: Number.isNaN(d.getTime()) ? undefined : d.toISOString() }))
                  }}
                  className="rounded border border-line bg-transparent px-2 py-0.5"
                />
              </label>
            )}
          </div>
        )}
      </Section>
      {!taskDate && (
        <Section title={TEXT.reminders} description={TEXT.remindersDescription}>
          <Switch
            aria-label={TEXT.reminders}
            checked={!!c.supportsReminders}
            onCheckedChange={(v) => save(withConstraints(def, { supportsReminders: v || undefined }))}
          />
        </Section>
      )}
      <Section title={TEXT.hideInCalendar} description={TEXT.hideInCalendarDescription}>
        <Switch
          aria-label={TEXT.hideInCalendar}
          checked={!!def.options.hideCalendarEvents}
          onCheckedChange={(v) => save({ ...def, options: { ...def.options, hideCalendarEvents: v } })}
        />
      </Section>
    </>
  )
}

// -- relation --------------------------------------------------------------------------------

interface RelationRules {
  allowedTypes: string[]
  isArray: boolean
  hasFixedSet: boolean
  fixedSet: string[]
}

function rulesOf(def: PropertyDef): RelationRules {
  return {
    allowedTypes: def.options.allowedTypes ?? [],
    isArray: def.options.isArray !== false,
    hasFixedSet: !!def.options.hasFixedSet,
    fixedSet: def.options.fixedSet ?? [],
  }
}

function sameRules(a: RelationRules, b: RelationRules): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

const SINGLE_MULTI = [
  { value: 'single', name: 'Single' },
  { value: 'multi', name: 'Multiple' },
] as const

function RelationSection({
  type,
  def,
  editor,
}: {
  type: TypeDef
  def: PropertyDef
  editor: TypeEditor
}) {
  const types = useLinkIndex((s) => s.types)
  const objects = useLinkIndex((s) => s.objects)
  const saved = useMemo(() => rulesOf(def), [def])
  const [rules, setRules] = useState(saved)
  useEffect(() => setRules(saved), [saved])
  const dirty = !sameRules(rules, saved)
  const targets = objectSelectTypes(types)

  const candidates = objects.filter(
    (o) => !o.template && (rules.allowedTypes.length === 0 || rules.allowedTypes.includes(o.type)),
  )
  const addToFixedSet = async (path: string) => {
    const o = objects.find((x) => x.path === path)
    if (!o) return
    const id = o.id ?? (await api.ensureId(o.path)).id
    if (!rules.fixedSet.includes(id)) setRules((r) => ({ ...r, fixedSet: [...r.fixedSet, id] }))
  }

  const apply = () =>
    void editor.save(
      updateProperty(type, def.id, (d) => ({ ...d, options: { ...d.options, ...rules } as PropertyOptions })),
    )

  const linked = types.find((t) => t.id === saved.allowedTypes[0])
  const syncedId = def.options.propertySyncing?.propertyIds?.[0] ?? null
  const eligible = (linked?.propertyDefinitions ?? []).filter(
    (p) =>
      p.type === 'entity' &&
      p.options.isArray !== false &&
      !p.options.hasFixedSet &&
      (p.options.allowedTypes ?? []).includes(type.id),
  )

  return (
    <>
      <Section title="Linked object type" description="Choose which object type this property is connected to.">
        <select
          aria-label="Linked object type"
          value={rules.allowedTypes[0] ?? ''}
          onChange={(e) => setRules((r) => ({ ...r, allowedTypes: e.target.value ? [e.target.value] : [] }))}
          className="rounded border border-line bg-raised px-2 py-1 text-[13px]"
        >
          <option value="">Any type</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Section>
      <Section
        title="Single or Multi-Select"
        description="Choose whether this property can link to just one object or multiple objects at the same time."
      >
        <div className="flex gap-1.5">
          {SINGLE_MULTI.map((o) => (
            <Choice
              key={o.value}
              selected={(o.value === 'multi') === rules.isArray}
              onClick={() => setRules((r) => ({ ...r, isArray: o.value === 'multi' }))}
            >
              {o.name}
            </Choice>
          ))}
        </div>
      </Section>
      <Section
        title="Enable fixed set"
        description="Limit selection to a predefined list of objects. Only objects from this fixed set will appear in the selection dropdown."
      >
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={rules.hasFixedSet}
            onChange={(e) => setRules((r) => ({ ...r, hasFixedSet: e.target.checked }))}
          />
          Fixed set
        </label>
        {rules.hasFixedSet && (
          <div className="mt-2 space-y-1">
            {rules.fixedSet.map((id) => {
              const o = objects.find((x) => x.id === id)
              return (
                <div key={id} className="flex items-center gap-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">{o?.title ?? id}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${o?.title ?? id} from set`}
                    onClick={() => setRules((r) => ({ ...r, fixedSet: r.fixedSet.filter((x) => x !== id) }))}
                    className="text-fg-muted hover:text-fg"
                  >
                    ✕
                  </button>
                </div>
              )
            })}
            <select
              aria-label="Add to fixed set"
              value=""
              onChange={(e) => e.target.value && void addToFixedSet(e.target.value)}
              className="rounded border border-line bg-raised px-2 py-1 text-[13px]"
            >
              <option value="">Add an object…</option>
              {candidates
                .filter((o) => !o.id || !rules.fixedSet.includes(o.id))
                .map((o) => (
                  <option key={o.path} value={o.path}>
                    {o.title}
                  </option>
                ))}
            </select>
          </div>
        )}
      </Section>
      {dirty && (
        <div className="rounded border border-line p-2">
          <p className="text-[13px] text-fg-muted">{TEXT.applyExplanation}</p>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setRules(saved)} className="rounded px-2 py-1 text-[13px] hover:bg-hover">
              Cancel
            </button>
            <button type="button" onClick={apply} className="rounded bg-hover px-2 py-1 text-[13px] font-medium">
              Apply changes
            </button>
          </div>
        </div>
      )}
      <Section title="Two-way linking" description={TEXT.syncExplanation}>
        {!linked || linked.basic || type.basic ? (
          <p className="text-[13px] text-fg-muted">{TEXT.notAllowed}</p>
        ) : !saved.isArray || saved.hasFixedSet ? (
          <p className="text-[13px] text-fg-muted">{TEXT.multiSelectOnly}</p>
        ) : (
          <div className="flex flex-col items-start gap-1">
            <Choice selected={syncedId === null} onClick={() => syncedId !== null && void editor.setSync(def.id, null)}>
              No Property
            </Choice>
            {eligible.map((p) => (
              <Choice key={p.id} selected={syncedId === p.id} onClick={() => syncedId !== p.id && void editor.setSync(def.id, p.id)}>
                {p.name}
              </Choice>
            ))}
            <Choice selected={false} onClick={() => void editor.setSync(def.id, null, type.name)}>
              {`Create property "${type.name}" for "${linked.pluralName}"`}
            </Choice>
          </div>
        )}
      </Section>
    </>
  )
}

// -- label -----------------------------------------------------------------------------------

function LabelSection({ type, def, save }: { type: TypeDef; def: PropertyDef; save(next: PropertyDef): void }) {
  const multi = !!def.options.isArray
  return (
    <>
      {!type.basic && (
        <Section title="Single or Multi-Select" description="Set whether a single label or multiple labels can be selected.">
          <div className="flex gap-1.5">
            {SINGLE_MULTI.map((o) => (
              <Choice
                key={o.value}
                selected={(o.value === 'multi') === multi}
                onClick={() =>
                  (o.value === 'multi') !== multi &&
                  save({ ...def, options: { ...def.options, isArray: o.value === 'multi' } })
                }
              >
                {o.name}
              </Choice>
            ))}
          </div>
        </Section>
      )}
      <Section
        title="Label set"
        description="Edit the list of available labels. Note that deleting a label here will also remove it from all objects where it is currently applied."
      >
        <div className="rounded border border-line p-1">
          <LabelMenu def={def} value={[]} onChange={() => undefined} onDefChange={(next) => save(next)} />
        </div>
      </Section>
    </>
  )
}

// -- change kind and delete ------------------------------------------------------------------

function ChangeKindSection({
  def,
  editor,
  onOpenProperty,
}: {
  def: PropertyDef
  editor: TypeEditor
  onOpenProperty?(id: string): void
}) {
  const kinds = allowedKindChanges(def.type)
  const [to, setTo] = useState<PropertyType | null>(null)
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!to) return
    setBusy(true)
    const res = await editor.changeKind(def.id, to)
    setBusy(false)
    if (res) onOpenProperty?.(res.newPropertyId)
  }
  return (
    <Section title="Change property type" description="Turn this property into a property of another type for all objects of this type.">
      {kinds.length === 0 ? (
        <p className="text-[13px] text-fg-muted">{TEXT.noTransformations}</p>
      ) : (
        <>
          <p className="text-[13px] text-fg-muted">{TEXT.changeTypeExplanation}</p>
          <div role="radiogroup" aria-label="New property type" className="mt-2 space-y-1">
            {kinds.map((k) => (
              <label key={k} className="flex items-center gap-2 text-[13px]">
                <input type="radio" name={`kind-${def.id}`} checked={to === k} onChange={() => setTo(k)} />
                {KIND_META[k].description ? `${KIND_META[k].name} — ${KIND_META[k].description}` : KIND_META[k].name}
              </label>
            ))}
          </div>
          <p className="mt-2 text-[13px] text-fg-muted">{TEXT.changeTypeWarning}</p>
          <label className="mt-1 flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            {TEXT.confirmText}
          </label>
          <button
            type="button"
            disabled={!to || !understood || busy}
            onClick={() => void run()}
            className="mt-2 rounded bg-hover px-3 py-1 text-[13px] font-medium disabled:opacity-50"
          >
            Change type
          </button>
        </>
      )}
    </Section>
  )
}

/** "Delete property": the user types `delete` (`delete-all-content` for a content property). */
export function DeletePropertySection({
  def,
  onDelete,
  onlyContent = false,
}: {
  def: PropertyDef
  onDelete(): void
  /** True when `def` is the type's only content (blocks) property. */
  onlyContent?: boolean
}) {
  const word = def.type === 'blocks' ? 'delete-all-content' : 'delete'
  const [typed, setTyped] = useState('')
  return (
    <Section title="Delete property" description={TEXT.deleteDescription}>
      {def.type === 'blocks' && (
        <p role="note" className="mb-2 text-[13px] text-amber-400">
          {onlyContent ? TEXT.onlyBlocksPropertyWarning : TEXT.blocksPropertyWarning}
        </p>
      )}
      <input
        aria-label={`Type "${word}" to confirm`}
        placeholder={word}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className="w-full rounded border border-line bg-transparent px-2 py-1 text-[13px] outline-none"
      />
      <button
        type="button"
        disabled={typed.trim() !== word}
        onClick={onDelete}
        className="mt-2 rounded bg-red-900/60 px-3 py-1 text-[13px] font-medium text-red-100 disabled:opacity-40"
      >
        Delete property
      </button>
    </Section>
  )
}

// -- dialog ----------------------------------------------------------------------------------

/** "Property settings": name and description, the kind's settings, visibility, change kind, delete. */
export function PropertySettings({ typeId, propertyId, open, onOpenChange, onOpenProperty, editor }: PropertySettingsProps) {
  const own = useTypeEditor(editor ? null : typeId)
  const ed = editor ?? own
  const type = useLinkIndex((s) => s.types.find((t) => t.id === typeId))
  const def = type?.propertyDefinitions.find((d) => d.id === propertyId)

  const [name, setName] = useState(def?.name ?? '')
  const [description, setDescription] = useState(def?.description ?? '')
  useEffect(() => setName(def?.name ?? ''), [def?.name])
  useEffect(() => setDescription(def?.description ?? ''), [def?.description])

  const readOnly = !!type?.readOnlyReason
  const save = (next: PropertyDef) => {
    if (type) void ed.save(updateProperty(type, next.id, () => next))
  }
  const remove = async () => {
    if (!type || !def) return
    const res = await ed.save(removeProperty(type, def.id), { confirm: true })
    if (res) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-auto border-line bg-raised-2 text-fg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[17px]">{TEXT.heading}</DialogTitle>
          <DialogDescription className="text-[13px] text-fg-muted">{TEXT.explanation}</DialogDescription>
        </DialogHeader>
        {type && def && (
          <fieldset disabled={readOnly} className="space-y-3">
            {type.readOnlyReason && <p className="text-[13px] text-fg-muted">{type.readOnlyReason}</p>}
            <label className="block text-[13px]">
              <span className="text-fg-muted">Name</span>
              <input
                aria-label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  const n = name.trim()
                  if (!n) setName(def.name)
                  else if (n !== def.name) save({ ...def, name: n })
                }}
                className="mt-1 w-full rounded border border-line bg-transparent px-2 py-1 text-[14px] outline-none"
              />
            </label>
            <label className="block text-[13px]">
              <span className="text-fg-muted">Description</span>
              <textarea
                aria-label="Description"
                placeholder={TEXT.descriptionPlaceholder}
                value={description}
                rows={2}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => description !== def.description && save({ ...def, description })}
                className="mt-1 w-full resize-none rounded border border-line bg-transparent px-2 py-1 text-[14px] outline-none"
              />
            </label>
            {def.type === 'number' && <NumberSection def={def} save={save} />}
            {(def.type === 'datetime' || def.type === 'datetimeSimple') && (
              <DateSection
                def={def}
                save={save}
                taskDate={def.key === 'date' && type.basic && type.name.toLowerCase() === 'task'}
              />
            )}
            {def.type === 'entity' && !type.basic && <RelationSection type={type} def={def} editor={ed} />}
            {def.type === 'label' && <LabelSection type={type} def={def} save={save} />}
            {canChangeVisibility(def) && (
              <Section title="Visibility" description="Decide whether you want this property to be visible on your object's page.">
                <div className="flex gap-1.5">
                  {VISIBILITY_OPTIONS.map((o) => (
                    <Choice
                      key={o.value}
                      selected={def.visibility === o.value}
                      onClick={() => def.visibility !== o.value && save({ ...def, visibility: o.value })}
                    >
                      {o.name}
                    </Choice>
                  ))}
                </div>
              </Section>
            )}
            {!type.basic && <ChangeKindSection key={def.id} def={def} editor={ed} onOpenProperty={onOpenProperty} />}
            {canDeleteProperty(type, def) && (
              <DeletePropertySection
                key={def.id}
                def={def}
                onDelete={() => void remove()}
                onlyContent={!type.propertyDefinitions.some((d) => d.type === 'blocks' && d.id !== def.id)}
              />
            )}
            {ed.error && (
              <p role="alert" className="text-[13px] text-red-400">
                {ed.error}
              </p>
            )}
          </fieldset>
        )}
        {!editor && own.dialog}
      </DialogContent>
    </Dialog>
  )
}
