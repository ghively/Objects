import { Fragment, memo, useMemo, useRef, useState, type ReactNode } from 'react'
import { COMPUTED_KINDS } from '@/api/types'
import type {
  ComputedValue,
  CounterpartRow,
  DateValue,
  EntityRef,
  Icon as IconValue,
  ObjectSummary,
  ObjectSynced,
  PropertyDef,
  PropertyType,
  TypeDef,
  WorkWriteResult,
} from '@/api/types'
import { Icon, IconOrEmoji, isIconifyId } from '@/components/Icon'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLinkIndex } from '@/links/linkIndex'
import { AddPropertyMenu, BASIC_TYPE_INFO } from '@/properties/AddPropertyMenu'
import { cellForDef, FRONTMATTER_KINDS } from '@/properties/cellFor'
import { propertyIsEmpty } from '@/properties/format'
import { kindIcon } from '@/properties/kinds'
import { PropertyMenu } from '@/properties/PropertyMenu'
import { isSynced, syncedStale, SyncedLine } from '@/properties/synced'
import { DeletePropertySection, PropertySettings } from '@/properties/PropertySettings'
import { useSettings } from '@/settings/useSettings'
import { useWorkOn } from '@/work/useWorkOn'
import { DEV_INFO_TEXT, DevInfo } from '@/settings/DevInfo'
import { LAYOUT_KEYS, removeProperty } from '@/properties/typeEdits'
import { CounterpartRows, mergeCounterparts } from './CounterpartRows'
import { isSystemProperty, ownFirst } from './paneOrder'
import type { TypeEditor } from './useTypeEditor'

/** Frontmatter keys shown elsewhere (header, metadata) or kept by the app, never as extra properties. */
const CORE_KEYS = new Set([
  'id',
  'type',
  'template',
  'title',
  'icon',
  'iconColor',
  'description',
  'aliases',
  'tags',
  'collections',
  'createdAt',
  'lastUpdated',
  'coverImage',
  'color',
  // M25's system block (where an imported object came from): shown as the Source line, never as an
  // External property (fix pass H).
  'importSource',
  ...LAYOUT_KEYS,
])

/**
 * M22's work kinds: their rows belong to the Work page. M32: with Work off for the space an empty
 * one is left out; one that holds a value still shows (no value is hidden by the Work switch).
 */
const WORK_KINDS: ReadonlySet<PropertyType> = new Set<PropertyType>(['steps', 'textList', 'floorItems'])

function isEmpty(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0)
  )
}

export function formatValue(v: unknown): string {
  if (Array.isArray(v)) return v.map(formatValue).join(', ')
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (v !== null && typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function guessKind(v: unknown): PropertyType {
  if (typeof v === 'number') return 'number'
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'string' && /^https?:\/\//.test(v)) return 'url'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return 'datetime'
  return 'text'
}

/** The type's properties, or (for a type without definitions) the object's extra frontmatter keys. */
export function propertyRows(type: TypeDef | undefined, frontmatter: Record<string, unknown>): PropertyDef[] {
  const defs = type?.propertyDefinitions ?? []
  if (defs.length) return defs
  return Object.keys(frontmatter)
    .filter((k) => !CORE_KEYS.has(k))
    .map(
      (k): PropertyDef => ({
        id: k,
        key: k,
        name: k,
        type: guessKind(frontmatter[k]),
        description: '',
        icon: null,
        visibility: 'alwaysShow',
        options: { isArray: Array.isArray(frontmatter[k]) },
      }),
    )
}

/** Frontmatter keys that no property of the type describes ("External properties"). */
export function externalKeys(type: TypeDef | undefined, frontmatter: Record<string, unknown>): string[] {
  const defs = type?.propertyDefinitions ?? []
  if (!defs.length) return []
  const known = new Set(defs.map((d) => d.key))
  return Object.keys(frontmatter).filter((k) => !known.has(k) && !CORE_KEYS.has(k))
}

// -- frontmatter → API value ---------------------------------------------------------------

function asList(raw: unknown): unknown[] {
  if (raw === null || raw === undefined) return []
  return Array.isArray(raw) ? raw : [raw]
}

function scalarText(raw: unknown): string | null {
  if (raw === null || raw === undefined || typeof raw === 'object') return null
  const s = String(raw)
  return s.trim() ? s : null
}

/** `[[Title]]`, `[[Title|alias]]` or a bare title → `Title`. */
export function linkTarget(raw: unknown): string | null {
  const s = scalarText(raw)
  if (!s) return null
  const m = /^\s*\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]\s*$/.exec(s)
  return (m ? m[1] : s).trim() || null
}

/** An object's icon from its `icon` and `iconColor` lines. */
export function decodeIcon(raw: unknown, color?: unknown): IconValue | null {
  if (raw && typeof raw === 'object' && 'val' in (raw as object)) return raw as IconValue
  const val = scalarText(raw)?.trim()
  if (!val) return null
  const icon: IconValue = { type: isIconifyId(val) ? 'iconify' : 'emoji', val }
  if (icon.type === 'iconify' && typeof color === 'string' && color.trim()) icon.color = color.trim()
  return icon
}

const MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?Z$/

function decodePoint(text: string, dayPref: boolean): { iso: string; day: boolean } | null {
  const t = text.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return { iso: t, day: true }
  const midnight = MIDNIGHT.exec(t)
  if (dayPref && midnight) return { iso: midnight[1], day: true }
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : { iso: d.toISOString(), day: false }
}

/** A date line (`2026-10-30`, a timestamp, or `start -> end`) as a `DateValue`. */
export function decodeDate(def: PropertyDef, raw: unknown): DateValue | null {
  if (raw && typeof raw === 'object' && 'start' in (raw as object)) return raw as DateValue
  const text = scalarText(raw)
  if (!text) return null
  const c = def.options.constraints
  const dayPref = c?.resolutionConstraint === 'day' || c?.resolutionPreference === 'day'
  const [a, b] = text.split(/\s+->\s+/)
  const start = decodePoint(a, dayPref)
  if (!start) return null
  const end = b !== undefined ? decodePoint(b, dayPref) : null
  const resolution = start.day && (!end || end.day) ? 'day' : 'time'
  const v: DateValue = { start: start.iso, resolution }
  if (end) v.end = end.iso
  return v
}

/** The value a property's cell shows, decoded from the raw frontmatter as the API's value forms. */
export function cellValue(
  def: PropertyDef,
  frontmatter: Record<string, unknown>,
  links: Record<string, (string | null)[]> = {},
  summary?: ObjectSummary,
  /** M5: the objects linking to this one (`GET /api/object`'s `backlinks`). */
  backlinks?: EntityRef[],
  /** M12: the object's formula and rollup values (`GET /api/object`'s `computed`), never in frontmatter. */
  computed?: Record<string, ComputedValue>,
  /** M29: the object's synced values (`GET /api/object`'s `synced`, decoded), never in frontmatter. */
  synced?: ObjectSynced,
): unknown {
  if (COMPUTED_KINDS.has(def.type)) return computed?.[def.key] ?? null
  // M29: a synced property shows the store's value; one typed into the file never shows (the
  // property is empty until its first sync).
  if (isSynced(def)) {
    const values = synced?.values ?? {}
    return def.key in values ? values[def.key] : cellValue({ ...def, synced: null }, {}, links, summary)
  }
  const raw = frontmatter[def.key]
  switch (def.type) {
    case 'entity_type':
      return summary?.type ?? scalarText(raw)
    case 'entity_icon':
      return decodeIcon(raw, frontmatter.iconColor)
    case 'entity_backlinks':
      return backlinks ?? null
    case 'number': {
      if (typeof raw === 'number') return raw
      const s = scalarText(raw)
      const n = s === null ? NaN : Number(s)
      return Number.isNaN(n) ? null : n
    }
    case 'boolean':
      return raw === true || (typeof raw === 'string' && ['true', 'yes', 'on', '1'].includes(raw.trim().toLowerCase()))
    case 'datetime':
    case 'datetimeSimple':
      return decodeDate(def, raw)
    case 'label':
    case 'entity_tags':
    case 'entity_aliases':
    case 'entity_collections':
      return asList(raw)
        .map(scalarText)
        .filter((t): t is string => !!t)
        .map((t) => t.trim())
    case 'entity': {
      const paths = links[def.key] ?? []
      const refs: EntityRef[] = []
      asList(raw).forEach((item, i) => {
        const target = linkTarget(item)
        if (target) refs.push({ target, path: paths[i] ?? null })
      })
      return refs
    }
    case 'files':
      // `[[Attachments/a.pdf]]` items → the space-relative paths the API sends.
      return asList(raw)
        .map(linkTarget)
        .filter((t): t is string => !!t)
    case 'textList':
      // M22: a list of one-line texts (a scalar reads as a one-item list).
      return asList(raw)
        .map(scalarText)
        .filter((t): t is string => !!t)
    case 'steps':
    case 'floorItems':
      // M22: the decoded list (ObjectView puts the server's decoding, with ids and revs, here).
      return Array.isArray(raw) ? raw : null
    default:
      if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
      return scalarText(raw)
  }
}

// -- panel ---------------------------------------------------------------------------------

export interface PropertyPanelProps {
  type?: TypeDef
  frontmatter: Record<string, unknown>
  /** Each entity value resolved from this file (`GET /api/object`'s `links`). */
  links?: Record<string, (string | null)[]>
  summary?: ObjectSummary
  /** M5: the objects linking to this one, shown by the backlinks property. */
  backlinks?: EntityRef[]
  /** M12: formula and rollup values by property key (`ObjectDetail.computed`). */
  computed?: Record<string, ComputedValue>
  /** M28: the computed other sides pointing here (`ObjectDetail.counterparts`). */
  counterparts?: CounterpartRow[]
  /** M29: the object's synced values and when they were refreshed (`ObjectDetail.synced`). */
  synced?: ObjectSynced
  /** M28: add or remove other objects on a counterpart row (writes their stored side). */
  onEditCounterpart?(key: string, add: string[], remove: string[]): Promise<void>
  readOnly?: boolean
  /** A cell committed `value` for the frontmatter `key`. */
  onChange?(key: string, value: unknown): void
  /** A cell committed several keys at once (one write; `remove` deletes keys). Passed to every cell. */
  onChangeMany?(updates: Record<string, unknown>, remove?: string[]): void
  /** M8: a date property's reminder (`PUT /api/tasks/reminder`). */
  onSetReminder?(key: string, remind: string | null): void
  /** M22: run a work write (steps, floor items) through the object's write queue (`writes.work`). */
  onWorkWrite?(run: (path: string, baseVersion: string) => Promise<WorkWriteResult>): Promise<WorkWriteResult | null>
  /** Save the type (a label option set changed); awaited before the cell's value is applied. */
  onTypeChange?(next: TypeDef): Promise<unknown> | void
  onOpenTag?(name: string): void
  onOpenObject?(path: string): void
  onChangeType?(): void
  /** The type editor ObjectView saves through; property settings use it for 428s and kind changes. */
  typeEditor?: TypeEditor
  /** Where the page layout puts the panel: the left side panel (Standard), a card, a column or an infobox. */
  variant?: 'side' | 'card' | 'column' | 'infobox'
  /** What the page shows under the properties (the Source line, Task Stats ...), inside the panel. */
  footer?: ReactNode
}

const PANEL_CLASS: Record<NonNullable<PropertyPanelProps['variant']>, string> = {
  side: 'w-[370px] shrink-0 overflow-auto border-r border-line bg-panel px-6 pt-8 pb-6',
  card: 'mb-8 rounded-xl border border-line bg-raised px-5 py-5',
  column: 'w-full',
  infobox: 'w-[var(--infobox-width)] shrink-0 self-start rounded-xl border border-line bg-raised px-4 py-5',
}

function Row({
  label,
  icon,
  menu,
  children,
}: {
  label: string
  icon: IconValue | string
  /** The PropertyMenu for this row; without one the label is plain text. */
  menu?: { open: boolean; onOpenChange(open: boolean): void; content: ReactNode }
  children: ReactNode
}) {
  // "Keep type settings inside Settings only": the label stays, its menu goes.
  const hideMenu = useSettings((s) => s.settings.hideTypeSettings)
  const heading = (
    <>
      <IconOrEmoji icon={icon} size={15} fallback="ph-note-blank" />
      <span>{label}</span>
    </>
  )
  return (
    <div className="px-1" data-property-row={label}>
      {menu && !hideMenu ? (
        <Popover open={menu.open} onOpenChange={menu.onOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`${label} property menu`}
              className="-mx-1 flex items-center gap-2 rounded px-1 text-[15px] font-medium hover:bg-hover"
            >
              {heading}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto border-line bg-raised p-1.5 text-fg">
            {menu.content}
          </PopoverContent>
        </Popover>
      ) : (
        <div className="flex items-center gap-2 text-[15px] font-medium">{heading}</div>
      )}
      <div className="mt-2">{children}</div>
    </div>
  )
}

/** The handlers every property row gets from the panel (stable across renders). */
interface RowHandlers {
  onChange(key: string, value: unknown): void
  onChangeMany?(updates: Record<string, unknown>, remove?: string[]): void
  onSetReminder?(key: string, remind: string | null): void
  onWorkWrite?(run: (path: string, baseVersion: string) => Promise<WorkWriteResult>): Promise<WorkWriteResult | null>
  onDefChange(next: PropertyDef): Promise<unknown>
  onTypeChange(next: TypeDef): Promise<unknown> | void
  onOpenTag?(name: string): void
  onOpenObject?(path: string): void
  onChangeType?(): void
  setMenuFor(id: string | null): void
  setSettingsFor(id: string | null): void
  /** "Delete property": a formula or rollup goes straight away, others ask to type `delete`. */
  deleteProperty(def: PropertyDef): void
}

interface PropertyRowProps {
  def: PropertyDef
  value: unknown
  readOnly: boolean
  /** M29: for a synced property, when its values were refreshed (null: not yet). */
  refreshedAt?: string | null
  frontmatter?: Record<string, unknown>
  /** The type, when its definitions can be edited here (the row's PropertyMenu and settings). */
  type?: TypeDef
  menuOpen: boolean
  typeId?: string
  path?: string
  handlers: RowHandlers
}

/** Equal JSON-like values (a cell's value is rebuilt from the frontmatter on every render). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  return ak.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** One property's label and cell: re-renders only when its own definition, value or state changes. */
const PropertyRow = memo(
  function PropertyRow({ def, value, readOnly, refreshedAt, frontmatter, type, menuOpen, typeId, path, handlers: h }: PropertyRowProps) {
    const Cell = cellForDef(def)
    // M29: a synced property is filled only through the API: read-only, with its source line.
    const synced = isSynced(def)
    const ro = readOnly || synced
    const stale = synced && syncedStale(def, refreshedAt)
    const menu = type
      ? {
          open: menuOpen,
          onOpenChange: (o: boolean) => h.setMenuFor(o ? def.id : null),
          content: (
            <PropertyMenu
              type={type}
              def={def}
              onSave={(next) => h.onTypeChange(next)}
              onEditProperty={() => {
                h.setMenuFor(null)
                h.setSettingsFor(def.id)
              }}
              onDelete={() => {
                h.setMenuFor(null)
                h.deleteProperty(def)
              }}
            />
          ),
        }
      : undefined
    const cell = Cell ? (
      <Cell
        def={def}
        value={value}
        readOnly={ro}
        onChange={(next: unknown) => {
          if (!synced) h.onChange(def.key, next)
        }}
        frontmatter={frontmatter}
        onChangeMany={ro ? undefined : h.onChangeMany}
        onSetReminder={ro ? undefined : h.onSetReminder}
        onWorkWrite={ro ? undefined : h.onWorkWrite}
        onDefChange={h.onDefChange}
        onOpenTag={h.onOpenTag}
        onOpenObject={h.onOpenObject}
        onChangeType={h.onChangeType}
        typeId={typeId}
        path={path}
        onOpenSettings={type ? () => h.setSettingsFor(def.id) : undefined}
      />
    ) : null
    return (
      <Row label={def.name} icon={def.icon ?? kindIcon(def.type)} menu={menu}>
        {synced ? (
          <>
            {/* Muted once stale (older than the property's stale-after days). */}
            <div data-synced-value="" data-stale-value={stale ? '' : undefined} className={stale ? 'text-fg-muted opacity-60' : undefined}>
              {cell}
            </div>
            <SyncedLine def={def} refreshedAt={refreshedAt ?? null} />
          </>
        ) : (
          cell
        )}
      </Row>
    )
  },
  (a, b) =>
    a.def === b.def &&
    sameValue(a.value, b.value) &&
    a.readOnly === b.readOnly &&
    a.refreshedAt === b.refreshedAt &&
    // Only the kinds whose cell reads sibling keys re-render for another key's change.
    (!FRONTMATTER_KINDS.has(a.def.type) || sameValue(a.frontmatter, b.frontmatter)) &&
    a.type === b.type &&
    a.menuOpen === b.menuOpen &&
    a.typeId === b.typeId &&
    a.path === b.path &&
    a.handlers === b.handlers,
)

/** Left-side property list: one editable cell per property of the object's type. */
export function PropertyPanel({
  type,
  frontmatter,
  links,
  summary,
  backlinks,
  computed,
  counterparts,
  synced,
  onEditCounterpart,
  readOnly,
  onChange,
  onChangeMany,
  onSetReminder,
  onWorkWrite,
  onTypeChange,
  onOpenTag,
  onOpenObject,
  onChangeType,
  typeEditor,
  variant = 'side',
  footer,
}: PropertyPanelProps) {
  const [showHidden, setShowHidden] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const [deleteFor, setDeleteFor] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const allTypes = useLinkIndex((s) => s.types)
  // Property definitions are edited through the type, whatever the object's own read-only state.
  const canEditType = !!type && !!onTypeChange && !type.readOnlyReason
  const deleting = deleteFor ? type?.propertyDefinitions.find((d) => d.id === deleteFor) : undefined
  const typed = (type?.propertyDefinitions.length ?? 0) > 0
  // M32: the work kinds' rows (steps, lists, floor items) belong to the Work page. With Work off
  // for the space the empty ones are left out of the panel; a row that holds a value still shows,
  // so the switch never hides a value (the back end keeps such a field on the type for the same
  // reason).
  const workOn = useWorkOn()
  // M33, choice 3: the type's own properties first, then the built-in rows (`ownFirst`; null: the
  // stored order, which is also what an order arranged by hand gets). Display only.
  const stored = propertyRows(type, frontmatter)
  const reordered = ownFirst(stored)
  const rows = (reordered ?? stored).filter(
    (d) => d.type !== 'entity_title' && (workOn || !WORK_KINDS.has(d.type) || !isEmpty(cellValue(d, frontmatter, links, summary))),
  )
  const visible: PropertyDef[] = []
  const hidden: PropertyDef[] = []
  for (const d of rows) {
    if (d.visibility === 'hidden') hidden.push(d)
    else if (d.visibility === 'hideWhenEmpty' && propertyIsEmpty(d, cellValue(d, frontmatter, links, summary, backlinks, computed, synced))) continue
    else visible.push(d)
  }
  const external = externalKeys(type, frontmatter)
  // M28: the computed other sides, after the type's own properties and before Backlinks. One
  // hidden while empty (its definition's `hideWhenEmpty`) waits under the "Hidden" toggle, so it
  // can still be filled from this side.
  const counterpartDefs = type?.counterparts ?? []
  const merged = mergeCounterparts(counterparts ?? [], counterpartDefs)
  const filledCounterparts = merged.filter((m) => m.paths.length > 0 || m.def.visibility === 'alwaysShow').length
  const emptyCounterparts = merged.length - filledCounterparts
  const backlinksAt = visible.findIndex((d) => d.type === 'entity_backlinks')
  // M33: with the own properties first the other sides still follow them directly (and still
  // come before Backlinks), so they stay with the type's own rows, above the built-in ones.
  const ownEnd = reordered ? visible.findLastIndex((d) => !isSystemProperty(d)) + 1 : visible.length
  const counterpartsAt = backlinksAt < 0 ? ownEnd : Math.min(backlinksAt, ownEnd)
  const ownBefore = visible.slice(0, counterpartsAt)
  const ownAfter = visible.slice(counterpartsAt)
  const hiddenCount = hidden.length + emptyCounterparts

  // The handlers rows get are stable (they read the newest props through `latest`), so a value
  // change re-renders only its own row, whatever handlers the parent passes per render.
  const latest = useRef({ type, onChange, onChangeMany, onSetReminder, onWorkWrite, onTypeChange, onOpenTag, onOpenObject, onChangeType, typeEditor })
  latest.current = { type, onChange, onChangeMany, onSetReminder, onWorkWrite, onTypeChange, onOpenTag, onOpenObject, onChangeType, typeEditor }
  const has = {
    onChangeMany: !!onChangeMany,
    onSetReminder: !!onSetReminder,
    onWorkWrite: !!onWorkWrite,
    onOpenTag: !!onOpenTag,
    onOpenObject: !!onOpenObject,
    onChangeType: !!onChangeType,
  }
  const handlers = useMemo<RowHandlers>(
    () => ({
      onChange: (key, next) => latest.current.onChange?.(key, next),
      onChangeMany: has.onChangeMany ? (u, r) => latest.current.onChangeMany?.(u, r) : undefined,
      onSetReminder: has.onSetReminder ? (key, remind) => latest.current.onSetReminder?.(key, remind) : undefined,
      onWorkWrite: has.onWorkWrite ? async (run) => (await latest.current.onWorkWrite?.(run)) ?? null : undefined,
      // Resolves the save's result (null when it failed), so a new label is applied only once saved.
      onDefChange: async (next) => {
        const { type: t, onTypeChange: save } = latest.current
        if (!t || !save) return null
        return save({ ...t, propertyDefinitions: t.propertyDefinitions.map((d) => (d.id === next.id ? next : d)) })
      },
      onTypeChange: (next) => latest.current.onTypeChange?.(next),
      onOpenTag: has.onOpenTag ? (name) => latest.current.onOpenTag?.(name) : undefined,
      onOpenObject: has.onOpenObject ? (path) => latest.current.onOpenObject?.(path) : undefined,
      onChangeType: has.onChangeType ? () => latest.current.onChangeType?.() : undefined,
      setMenuFor,
      setSettingsFor,
      deleteProperty: (def) => {
        const { type: t, typeEditor: ed, onTypeChange: save } = latest.current
        // A formula or rollup holds no values in the files (the server deletes it without a
        // confirmation): no typed confirmation either.
        if (!t || !COMPUTED_KINDS.has(def.type)) return setDeleteFor(def.id)
        const next = removeProperty(t, def.id)
        if (ed) void ed.save(next, { confirm: true })
        else void save?.(next)
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only whether each handler is given matters
    [has.onChangeMany, has.onSetReminder, has.onWorkWrite, has.onOpenTag, has.onOpenObject, has.onChangeType],
  )

  // Without a type definition (M1 inference) the row is a plain read-only value.
  const ro = !!readOnly || !typed || !onChange
  const editDefs = canEditType && typed && !!type
  const counterpartProps = {
    rows: counterparts ?? [],
    defs: counterpartDefs,
    readOnly: !!readOnly || !onEditCounterpart,
    onEdit: (key: string, add: string[], remove: string[]) => onEditCounterpart?.(key, add, remove) ?? Promise.resolve(),
    onOpenObject,
  }
  const renderRow = (def: PropertyDef) => (
    <PropertyRow
      def={def}
      value={cellValue(def, frontmatter, links, summary, backlinks, computed, synced)}
      readOnly={ro}
      refreshedAt={isSynced(def) ? (synced?.refreshedAt ?? null) : undefined}
      frontmatter={frontmatter}
      type={editDefs ? type : undefined}
      menuOpen={menuFor === def.id}
      typeId={type?.id ?? summary?.type}
      path={summary?.path}
      handlers={handlers}
    />
  )

  return (
    <aside
      aria-label="Properties"
      data-panel-variant={variant}
      className={`group/panel text-fg ${PANEL_CLASS[variant]}`}
    >
      {ownBefore.map((def, i) => (
        <Fragment key={def.id}>
          {i > 0 && <hr className="my-3 border-line" />}
          {renderRow(def)}
        </Fragment>
      ))}
      {filledCounterparts > 0 && <CounterpartRows {...counterpartProps} only="filled" leadingRule={ownBefore.length > 0} />}
      {ownAfter.map((def, i) => (
        <Fragment key={def.id}>
          {(i > 0 || ownBefore.length > 0 || filledCounterparts > 0) && <hr className="my-3 border-line" />}
          {renderRow(def)}
        </Fragment>
      ))}
      {hiddenCount > 0 && (
        <div className="mt-4">
          <button
            type="button"
            aria-expanded={showHidden}
            onClick={() => setShowHidden((v) => !v)}
            className="flex items-center gap-1.5 px-1 text-[14px] text-fg-muted hover:text-fg"
          >
            <Icon name={showHidden ? 'ph-caret-down' : 'ph-caret-right'} size={12} />
            {`Hidden (${hiddenCount})`}
          </button>
          {showHidden &&
            hidden.map((def) => (
              <Fragment key={def.id}>
                <hr className="my-3 border-line" />
                {renderRow(def)}
              </Fragment>
            ))}
          {showHidden && emptyCounterparts > 0 && <CounterpartRows {...counterpartProps} only="empty" leadingRule />}
        </div>
      )}
      {external.length > 0 && (
        <section aria-label="External properties" className="mt-6">
          <h3 className="px-1 text-[13px] font-semibold text-fg-muted">External properties</h3>
          {external.map((k) => {
            const v = frontmatter[k]
            return (
              <div key={k} className="mt-3 px-1">
                <div className="text-[15px] font-medium">{k}</div>
                <p className="mt-1 text-[15px] break-words whitespace-pre-wrap text-fg-muted">
                  {isEmpty(v) ? 'Empty' : formatValue(v)}
                </p>
              </div>
            )
          })}
        </section>
      )}
      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-type-setting=""
            disabled={!canEditType || !!type?.basic}
            title={type?.basic ? BASIC_TYPE_INFO : undefined}
            className="mt-5 flex items-center gap-2 px-1 text-[15px] text-fg-muted opacity-15 transition-opacity group-hover/panel:opacity-100 hover:text-fg disabled:hover:text-fg-muted"
          >
            <Icon name="ph-plus" size={14} />
            Add Property
          </button>
        </PopoverTrigger>
        {type && (
          <PopoverContent align="start" className="w-auto border-line bg-raised p-1.5 text-fg">
            <AddPropertyMenu
              type={type}
              types={allTypes}
              onSave={(next) => onTypeChange?.(next)}
              onClose={() => setAddOpen(false)}
            />
          </PopoverContent>
        )}
      </Popover>
      {footer && <div data-panel-footer="" className="mt-4">{footer}</div>}
      {summary && (
        <DevInfo
          className="mt-4"
          rows={[
            { label: DEV_INFO_TEXT.objectId, value: summary.id },
            { label: DEV_INFO_TEXT.filePath, value: summary.path },
          ]}
        />
      )}
      {type && settingsFor && (
        <PropertySettings
          typeId={type.id}
          propertyId={settingsFor}
          open
          onOpenChange={(o) => !o && setSettingsFor(null)}
          onOpenProperty={setSettingsFor}
          editor={typeEditor}
          objectPath={summary?.path}
        />
      )}
      {type && deleting && (
        <Dialog open onOpenChange={(o) => !o && setDeleteFor(null)}>
          <DialogContent className="border-line bg-raised-2 text-fg">
            <DialogHeader>
              <DialogTitle className="text-[17px]">{`Delete "${deleting.name}"?`}</DialogTitle>
              <DialogDescription className="text-[13px] text-fg-muted">
                The property and its values are removed from every note of this type.
              </DialogDescription>
            </DialogHeader>
            <DeletePropertySection
              def={deleting}
              onDelete={() => {
                setDeleteFor(null)
                const next = removeProperty(type, deleting.id)
                // The user typed the confirmation word, so no second (428) confirmation.
                if (typeEditor) void typeEditor.save(next, { confirm: true })
                else void onTypeChange?.(next)
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </aside>
  )
}
