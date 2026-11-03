import { useEffect, useMemo, useState } from 'react'
import type { EntityRef, ObjectSummary, PropertyDef } from '@/api/types'
import { IconOrEmoji, Icon } from '@/components/Icon'
import { fuzzyMatch } from '@/links/LinkPicker'
import { ensureLinkIndex, typeOf, useLinkIndex } from '@/links/linkIndex'

const LIMIT = 50

export interface RelationPickerProps {
  def: PropertyDef
  value: EntityRef[]
  onChange(next: EntityRef[]): void
  /** Called after a single-select pick. */
  onClose?(): void
  /** "Edit Property": opens the property's settings. */
  onOpenSettings?(): void
}

export const RELATION_PICKER_TEXT = {
  nothingFound: 'Nothing found',
  nothingToSelect: 'Nothing to select in this set. Search the whole database to add objects to the set.',
  editProperty: 'Edit Property',
}

function folderOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

/** The objects a relation property may link to: its allowed types, restricted to its fixed set. */
export function relationCandidates(def: PropertyDef, objects: ObjectSummary[]): ObjectSummary[] {
  const allowed = def.options.allowedTypes ?? []
  const fixed = def.options.hasFixedSet ? new Set(def.options.fixedSet ?? []) : null
  return objects.filter(
    (o) =>
      !o.template &&
      (allowed.length === 0 || allowed.includes(o.type)) &&
      (!fixed || (o.id !== null && fixed.has(o.id))),
  )
}

/**
 * "Search for objects": the objects of the property's allowed types (only the fixed set, under
 * "Selection set", when there is one). Two objects with the same title show their folder.
 * Values are `EntityRef`s with the picked object's path.
 */
export function RelationPicker({ def, value, onChange, onClose, onOpenSettings }: RelationPickerProps) {
  const objects = useLinkIndex((s) => s.objects)
  const [query, setQuery] = useState('')
  const multi = def.options.isArray ?? true

  useEffect(() => {
    void ensureLinkIndex()
  }, [])

  const candidates = useMemo(() => relationCandidates(def, objects), [def, objects])
  const duplicates = useMemo(() => {
    const seen = new Map<string, number>()
    for (const o of candidates) seen.set(o.title.toLowerCase(), (seen.get(o.title.toLowerCase()) ?? 0) + 1)
    return seen
  }, [candidates])
  const shown = useMemo(
    () => (query.trim() ? fuzzyMatch(query.trim(), candidates, LIMIT) : candidates.slice(0, LIMIT)),
    [query, candidates],
  )

  const isSelected = (o: ObjectSummary) => value.some((v) => v.path === o.path)
  const pick = (o: ObjectSummary) => {
    const ref: EntityRef = { target: o.title, path: o.path }
    if (multi) {
      onChange(isSelected(o) ? value.filter((v) => v.path !== o.path) : [...value, ref])
      return
    }
    onChange(isSelected(o) ? [] : [ref])
    onClose?.()
  }

  return (
    <div className="flex max-h-[20rem] w-72 flex-col">
      <div className="border-b border-line p-1.5">
        <input
          aria-label="Search for objects"
          placeholder="Search for objects"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && shown[0]) {
              e.preventDefault()
              pick(shown[0])
            }
          }}
          className="h-7 w-full rounded bg-transparent px-1.5 text-[14px] text-fg outline-none placeholder:text-fg-muted"
        />
      </div>
      <div role="listbox" aria-multiselectable={multi} aria-label={def.name} className="flex-1 overflow-y-auto p-1">
        {def.options.hasFixedSet && (
          <div className="px-2 py-0.5 text-[12px] text-fg-muted">Selection set</div>
        )}
        {shown.map((o) => {
          const selected = isSelected(o)
          const dup = (duplicates.get(o.title.toLowerCase()) ?? 0) > 1
          const type = typeOf(o.type)
          return (
            <div
              key={o.path}
              role="option"
              aria-selected={selected}
              tabIndex={-1}
              onClick={() => pick(o)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  pick(o)
                }
              }}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[14px] hover:bg-hover"
            >
              <span className="shrink-0 text-fg-muted">
                <IconOrEmoji icon={o.icon ?? type?.icon ?? null} size={14} fallback="ph-file-text" />
              </span>
              <span className="min-w-0 truncate text-fg">{o.title}</span>
              {dup && <span className="min-w-0 truncate text-[12px] text-fg-muted">{folderOf(o.path)}</span>}
              {selected && (
                <span className="ml-auto shrink-0 text-fg-muted">
                  <Icon name="ph-check" size={14} />
                </span>
              )}
            </div>
          )
        })}
        {shown.length === 0 && (
          <p className="px-2 py-1 text-[13px] text-fg-muted">
            {def.options.hasFixedSet && candidates.length === 0
              ? RELATION_PICKER_TEXT.nothingToSelect
              : RELATION_PICKER_TEXT.nothingFound}
          </p>
        )}
      </div>
      {onOpenSettings && (
        <div data-structure-setting="" className="border-t border-line p-1">
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[14px] text-fg-muted hover:bg-hover hover:text-fg"
          >
            <Icon name="ph-gear-six" size={14} />
            {RELATION_PICKER_TEXT.editProperty}
          </button>
        </div>
      )}
    </div>
  )
}
