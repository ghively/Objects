/**
 * M28: the computed other sides of relations pointing at this object ("Runs", "Documented in"),
 * shown as editable property rows after the type's own properties. Rows with the same key (Script,
 * Command and Runbook "Documented in") merge into one row; an edit writes the stored side of each
 * other object (`api.editCounterpart`), never this object's file.
 *
 * The picker is the relation picker over the row's virtual definition (`TypeDef.counterparts`),
 * whose `allowedTypes` are the merged sources, so it offers only objects that can hold the link.
 * A picked object's type names the source to write; a removed chip's row names it.
 */
import { Fragment, useState, type ReactNode } from 'react'
import { api } from '@/api/client'
import type { CounterpartRow, EntityRef, PropertyDef } from '@/api/types'
import { IconOrEmoji } from '@/components/Icon'
import { typeLabel } from '@/lib/typeLabel'
import { summaryOf, typeOf } from '@/links/linkIndex'
import { RelationCell } from '@/properties/cells/RelationCell'

export const COUNTERPART_TEXT = {
  /** The picker's hint when the merged row's sources are several types. */
  /** M32: was "Pick an object of {types}." */
  mixed: 'Pick one of {types}.',
}

const COUNTERPART_ICON = 'ph-arrows-left-right'

export interface CounterpartRowsProps {
  /** `ObjectDetail.counterparts`: one per source type and key. */
  rows: CounterpartRow[]
  /** The type's virtual counterpart definitions (`TypeDef.counterparts`). */
  defs: PropertyDef[]
  /** Chips only, no picker or remove. */
  readOnly?: boolean
  /** Add or remove other objects on the row with `key`. */
  onEdit(key: string, add: string[], remove: string[]): Promise<void>
  onOpenObject?(path: string): void
  /**
   * Which merged rows to render (the property panel shows the filled ones among the properties and
   * the empty ones under its "Hidden" toggle). Default: all.
   */
  only?: 'filled' | 'empty'
  /** A rule before the first row, as the panel puts between its rows. */
  leadingRule?: boolean
}

/** One row on the page: the rows with one key, merged, under one definition. */
export interface MergedCounterpart {
  key: string
  def: PropertyDef
  /** The `CounterpartRow`s merged here (one per source type). */
  rows: CounterpartRow[]
  /** Every linked object, in the rows' order, once. */
  paths: string[]
}

function fallbackDef(row: CounterpartRow): PropertyDef {
  return {
    id: `counterpart:${row.key}`,
    key: row.key,
    name: row.name,
    type: 'entity',
    description: '',
    icon: { type: 'iconify', val: COUNTERPART_ICON },
    visibility: 'hideWhenEmpty',
    options: { isArray: true, allowedTypes: [], hasFixedSet: false, fixedSet: [], counterpartOf: [] },
  }
}

/**
 * The rows merged by key, in the definitions' order (then keys only the rows name). The merged
 * definition's `allowedTypes` also holds every row's source, so the picker offers each of them.
 */
export function mergeCounterparts(rows: CounterpartRow[], defs: PropertyDef[]): MergedCounterpart[] {
  const byKey = new Map<string, MergedCounterpart>()
  for (const def of defs) if (!byKey.has(def.key)) byKey.set(def.key, { key: def.key, def, rows: [], paths: [] })
  for (const row of rows) {
    let m = byKey.get(row.key)
    if (!m) {
      m = { key: row.key, def: fallbackDef(row), rows: [], paths: [] }
      byKey.set(row.key, m)
    }
    m.rows.push(row)
    for (const p of row.paths) if (!m.paths.includes(p)) m.paths.push(p)
  }
  for (const m of byKey.values()) {
    const allowed = m.def.options.allowedTypes ?? []
    const missing = m.rows.map((r) => r.sourceTypeId).filter((t, i, all) => !allowed.includes(t) && all.indexOf(t) === i)
    if (missing.length) m.def = { ...m.def, options: { ...m.def.options, allowedTypes: [...allowed, ...missing] } }
  }
  return [...byKey.values()]
}

/** "Script, Command or Runbook". */
function typeNames(ids: string[]): string {
  const names = ids.map((id) => typeLabel(typeOf(id), id))
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

/**
 * The edit `CounterpartRows` runs for the object at `path`: one `api.editCounterpart` per source
 * type (an added object's type; a removed one's row), each result's rows handed to `onRows`.
 * Objects the server skipped (gone, read-only) reject with their reasons, after the rows are taken.
 */
export function counterpartEditor(
  path: string,
  current: () => CounterpartRow[],
  onRows: (rows: CounterpartRow[]) => void,
): (key: string, add: string[], remove: string[]) => Promise<void> {
  return async (key, add, remove) => {
    const rows = current().filter((r) => r.key === key)
    const bySource = new Map<string, { add: string[]; remove: string[] }>()
    const slot = (source: string) => {
      let s = bySource.get(source)
      if (!s) bySource.set(source, (s = { add: [], remove: [] }))
      return s
    }
    for (const p of add) {
      const source = summaryOf(p)?.type ?? (rows.length === 1 ? rows[0].sourceTypeId : undefined)
      if (source) slot(source).add.push(p)
    }
    for (const p of remove) {
      const row = rows.find((r) => r.paths.includes(p))
      if (row) slot(row.sourceTypeId).remove.push(p)
    }
    const skipped: string[] = []
    for (const [sourceTypeId, change] of bySource) {
      const res = await api.editCounterpart({ path, key, sourceTypeId, ...change })
      onRows(res.counterparts)
      for (const s of res.skipped) skipped.push(`${summaryOf(s.path)?.title ?? s.path}: ${s.reason}`)
    }
    if (skipped.length) throw new Error(skipped.join(' '))
  }
}

function CounterpartRowView({
  merged,
  readOnly,
  onEdit,
  onOpenObject,
}: {
  merged: MergedCounterpart
  readOnly: boolean
  onEdit: CounterpartRowsProps['onEdit']
  onOpenObject?(path: string): void
}) {
  const [error, setError] = useState<string | null>(null)
  const { def, paths } = merged
  const value: EntityRef[] = paths.map((p) => ({ target: summaryOf(p)?.title ?? p.replace(/^.*\//, '').replace(/\.md$/i, ''), path: p }))
  const change = (next: EntityRef[] | null) => {
    const picked = (next ?? []).map((r) => r.path).filter((p): p is string => !!p)
    const add = picked.filter((p) => !paths.includes(p))
    const remove = paths.filter((p) => !picked.includes(p))
    if (add.length === 0 && remove.length === 0) return
    const sources = def.options.allowedTypes ?? []
    if (add.some((p) => !sources.includes(summaryOf(p)?.type ?? ''))) {
      setError(COUNTERPART_TEXT.mixed.replace('{types}', typeNames(sources)))
      return
    }
    setError(null)
    onEdit(merged.key, add, remove).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }
  return (
    <div className="px-1" data-property-row={def.name} data-counterpart={merged.key}>
      <div className="flex items-center gap-2 text-[15px] font-medium">
        <IconOrEmoji icon={def.icon ?? COUNTERPART_ICON} size={15} fallback={COUNTERPART_ICON} />
        <span>{def.name}</span>
      </div>
      <div className="mt-2">
        <RelationCell def={def} value={value} readOnly={readOnly} onChange={change} onOpenObject={onOpenObject} />
        {error && (
          <p role="alert" className="mt-1 text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

export function CounterpartRows({ rows, defs, readOnly, onEdit, onOpenObject, only, leadingRule }: CounterpartRowsProps): ReactNode {
  const merged = mergeCounterparts(rows, defs).filter(
    (m) => !only || (only === 'filled') === (m.paths.length > 0 || m.def.visibility === 'alwaysShow'),
  )
  return merged.map((m, i) => (
    <Fragment key={m.key}>
      {(i > 0 || leadingRule) && <hr className="my-3 border-line" />}
      <CounterpartRowView merged={m} readOnly={!!readOnly} onEdit={onEdit} onOpenObject={onOpenObject} />
    </Fragment>
  ))
}
