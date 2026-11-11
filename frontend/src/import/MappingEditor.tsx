// "Review mappings": what makes the types (Obsidian and Anytype: top-level folders, a frontmatter
// key or nothing), one row per planned type (name, plural, object count, "Don't import", and the
// existing type to add to when importing into this space) and, under each, its properties (name,
// kind with the guessed one marked, "Multiple values" for labels and objects, examples, how many
// values won't fit, "Don't import"). Every change goes to `onChange`; the dialog re-previews.
// Each row is a labelled group inside a list item, so the lists keep their semantics (review O3);
// "Add to" offers only the types imported notes can go into (`canReceiveImport`, finding 5).
import { typeLabel } from '@/lib/typeLabel'
import { useId, useState } from 'react'
import { IMPORT_KINDS, type ImportMapping, type ImportPlannedType, type ImportPreview, type ImportSystemKey, type TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { KIND_META } from '@/properties/kinds'
import {
  canReceiveImport,
  effectiveProperty,
  effectiveType,
  kindTakesArray,
  NEW_TYPE,
  withPropertyKind,
  withPropertyOverride,
  withTypeOverride,
  withTypeSource,
  type ImportTargetKind,
} from './mapping'
import { IMPORT_TEXT as T } from './text'

const SYSTEM_FIELD: Record<ImportSystemKey, string> = {
  title: KIND_META.entity_title.name,
  tags: KIND_META.entity_tags.name,
  aliases: KIND_META.entity_aliases.name,
  description: KIND_META.entity_description.name,
  createdAt: KIND_META.entity_createdAt.name,
  lastUpdated: KIND_META.entity_lastUpdated.name,
}

const TYPE_SOURCES: { value: ImportMapping['typeSource']; label: string }[] = [
  { value: 'folder', label: T.typesFromFolder },
  { value: 'key', label: T.typesFromKey },
  { value: 'none', label: T.typesFromNone },
]

const inputClass =
  'h-8 min-w-0 rounded-md border border-line bg-transparent px-2 text-[13px] font-normal outline-none focus:border-fg-muted disabled:opacity-50'
const selectClass = 'h-8 min-w-0 rounded-md border border-line bg-raised px-2 text-[13px] font-normal disabled:opacity-50'

export interface MappingEditorProps {
  preview: ImportPreview
  mapping: ImportMapping
  onChange(next: ImportMapping): void
  target: ImportTargetKind
  /** The open space's types (for "Add to" when importing into this space). */
  spaceTypes: TypeDef[]
  /** The key the first preview chose for "A frontmatter key" (Anytype's own type key). */
  defaultTypeKey: string | null
}

export function MappingEditor({ preview, mapping, onChange, target, spaceTypes, defaultTypeKey }: MappingEditorProps) {
  const id = useId()
  const sourceChoice = preview.kind !== 'notion'
  const keys = preview.frontmatterKeys
  const keyOptions =
    mapping.typeKey && !keys.some(([k]) => k === mapping.typeKey) ? [[mapping.typeKey, 0] as [string, number], ...keys] : keys

  const pickSource = (value: ImportMapping['typeSource']) => {
    if (value === mapping.typeSource) return
    onChange(withTypeSource(mapping, value, mapping.typeKey ?? defaultTypeKey ?? keys[0]?.[0] ?? null))
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <h3 id={`${id}-heading`} className="text-[14px] font-semibold">
        {T.mappings}
      </h3>
      {sourceChoice && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[13px] font-semibold">{T.typesFrom}</legend>
          {TYPE_SOURCES.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-[13px]">
              <input
                type="radio"
                name={`${id}-type-source`}
                value={o.value}
                checked={mapping.typeSource === o.value}
                disabled={o.value === 'key' && keyOptions.length === 0}
                onChange={() => pickSource(o.value)}
              />
              {o.label}
            </label>
          ))}
          {mapping.typeSource === 'key' && (
            <label className="ml-6 flex items-center gap-2 text-[13px]">
              {T.typeKey}
              <select
                value={mapping.typeKey ?? ''}
                onChange={(e) => onChange(withTypeSource(mapping, 'key', e.target.value))}
                className={selectClass}
              >
                {keyOptions.map(([k, n]) => (
                  <option key={k} value={k}>
                    {T.typeKeyOption(k, n)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </fieldset>
      )}
      <ul aria-label={T.types} className="flex flex-col gap-2">
        {preview.types.map((t) => (
          <TypeRow key={t.key} type={t} mapping={mapping} onChange={onChange} target={target} spaceTypes={spaceTypes} />
        ))}
      </ul>
    </section>
  )
}

/** The preview row of the images that become Image objects (the server's `key`). */
const IMAGE_ROW = 'image'

function TypeRow({
  type: t,
  mapping,
  onChange,
  target,
  spaceTypes,
}: {
  type: ImportPlannedType
  mapping: ImportMapping
  onChange(next: ImportMapping): void
  target: ImportTargetKind
  spaceTypes: TypeDef[]
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const eff = effectiveType(t, mapping)
  const set = (patch: Parameters<typeof withTypeOverride>[2]) => onChange(withTypeOverride(mapping, t.key, patch))
  const into = target === 'currentSpace' && eff.existingTypeId !== NEW_TYPE
  if (t.key === IMAGE_ROW) {
    // AC-2: the images the Page row would take become Image objects; the server refuses a
    // mapping entry for this row, so it is shown as it is, with nothing to change.
    return (
      <li>
        <div role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-1 rounded-lg border border-line p-2.5">
          <div className="flex items-baseline justify-between gap-2 text-[13px]">
            <span id={`${id}-label`} className="min-w-0 truncate font-semibold" title={t.originLabel}>
              {t.originLabel}
            </span>
            <span className="shrink-0 text-fg-muted">{T.objectCount(t.objectCount)}</span>
          </div>
          <p className="text-[12px] text-fg-muted">{T.imageRow}</p>
        </div>
      </li>
    )
  }
  // The types imported notes can go into, and the one chosen now even if it can't (the server's
  // answer is shown as it is; it refuses that type when the import starts).
  const addTo = spaceTypes.filter((s) => canReceiveImport(s) || (into && s.id === eff.existingTypeId))
  return (
    <li>
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        data-skipped={eff.skip || undefined}
        className="flex flex-col gap-2 rounded-lg border border-line p-2.5 data-[skipped]:opacity-60"
      >
        <div className="flex items-baseline justify-between gap-2 text-[13px]">
          <span id={`${id}-label`} className="min-w-0 truncate font-semibold" title={t.originLabel}>
            {t.originLabel}
          </span>
          <span className="shrink-0 text-fg-muted">{T.objectCount(t.objectCount)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5 text-[12px] text-fg-muted">
            {T.typeName}
            <input
              value={eff.name}
              disabled={eff.skip || into}
              spellCheck={false}
              onChange={(e) => set({ name: e.target.value })}
              className={`${inputClass} text-fg`}
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[12px] text-fg-muted">
            {T.pluralName}
            <input
              value={eff.pluralName}
              disabled={eff.skip || into}
              spellCheck={false}
              onChange={(e) => set({ pluralName: e.target.value })}
              className={`${inputClass} text-fg`}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={eff.skip} onChange={(e) => set({ skip: e.target.checked })} />
            {T.skip}
          </label>
          {target === 'currentSpace' && (
            <label className="flex items-center gap-1.5">
              {T.existingType}
              <select
                value={eff.existingTypeId}
                disabled={eff.skip}
                onChange={(e) => set({ existingTypeId: e.target.value })}
                className={selectClass}
              >
                <option value={NEW_TYPE}>{T.newType}</option>
                {addTo.map((s) => (
                  <option key={s.id} value={s.id}>
                    {typeLabel(s)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-props`}
            onClick={() => setOpen((o) => !o)}
            className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-fg-muted hover:bg-hover hover:text-fg"
          >
            <Icon name={open ? 'ph-caret-down' : 'ph-caret-right'} size={12} />
            {T.showProperties(t.properties.length)}
          </button>
        </div>
        {open && (
          <div id={`${id}-props`}>
            {t.properties.length === 0 ? (
              <p className="text-[13px] text-fg-muted">{T.noProperties}</p>
            ) : (
              <ul aria-label={T.showProperties(t.properties.length)} className="flex flex-col gap-1.5">
                {t.properties.map((p) => (
                  <PropertyRow
                    key={p.key}
                    typeKey={t.key}
                    property={p}
                    mapping={mapping}
                    onChange={onChange}
                    disabled={eff.skip}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

function PropertyRow({
  typeKey,
  property: p,
  mapping,
  onChange,
  disabled,
}: {
  typeKey: string
  property: ImportPlannedType['properties'][number]
  mapping: ImportMapping
  onChange(next: ImportMapping): void
  disabled: boolean
}) {
  const id = useId()
  const eff = effectiveProperty(typeKey, p, mapping)
  const set = (patch: Parameters<typeof withPropertyOverride>[3]) => onChange(withPropertyOverride(mapping, typeKey, p.key, patch))
  if (p.systemKey) {
    return (
      <li className="flex items-baseline justify-between gap-2 rounded-md bg-hover/50 px-2 py-1 text-[13px]">
        <span className="min-w-0 truncate">{p.sourceName}</span>
        <span className="shrink-0 text-fg-muted">{T.fills(SYSTEM_FIELD[p.systemKey])}</span>
      </li>
    )
  }
  const off = disabled || eff.skip
  return (
    <li>
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        data-skipped={eff.skip || undefined}
        className="flex flex-col gap-1 rounded-md bg-hover/50 px-2 py-1.5 data-[skipped]:opacity-60"
      >
        <span id={`${id}-label`} className="truncate text-[12px] font-semibold" title={p.sourceName}>
          {p.sourceName}
        </span>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-[12px] text-fg-muted">
            {T.propertyName}
            <input
              value={eff.name}
              disabled={off}
              spellCheck={false}
              onChange={(e) => set({ name: e.target.value })}
              className={`${inputClass} text-fg`}
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[12px] text-fg-muted">
            {T.propertyKind}
            <select
              value={eff.kind}
              disabled={off}
              onChange={(e) => onChange(withPropertyKind(mapping, typeKey, p.key, e.target.value as (typeof IMPORT_KINDS)[number]))}
              className={`${selectClass} text-fg`}
            >
              {IMPORT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k === p.guessedKind ? T.guessed(KIND_META[k].name) : KIND_META[k].name}
                </option>
              ))}
            </select>
          </label>
          {kindTakesArray(eff.kind) && (
            <label className="flex h-8 items-center gap-1.5 text-[13px]">
              <input type="checkbox" checked={eff.isArray} disabled={off} onChange={(e) => set({ isArray: e.target.checked })} />
              {T.multiple}
            </label>
          )}
          <label className="flex h-8 items-center gap-1.5 text-[13px]">
            <input type="checkbox" checked={eff.skip} disabled={disabled} onChange={(e) => set({ skip: e.target.checked })} />
            {T.skip}
          </label>
        </div>
        {p.samples.length > 0 && (
          <p className="truncate text-[12px] text-fg-muted" title={p.samples.join(', ')}>
            {T.samples} {p.samples.join(', ')}
          </p>
        )}
        {!eff.skip && p.unconvertible > 0 && <p className="text-[12px] text-danger">{T.unconvertible(p.unconvertible)}</p>}
      </div>
    </li>
  )
}
