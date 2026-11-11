import { typeLabel } from '@/lib/typeLabel'
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import type { EntityRef, ObjectSummary, PropertyDef, TypeDef } from '@/api/types'
import { IconOrEmoji, Icon } from '@/components/Icon'
import { suggestFor } from '@/create/suggestContext'
import { SUGGEST_TEXT } from '@/create/typeSuggest'
import { showToast } from '@/editor/media/upload'
import { TypeChip } from '@/shell/Sidebar'
import { creatableTypes, createTitled, fuzzyMatch } from '@/links/LinkPicker'
import { ensureLinkIndex, typeOf, useLinkIndex } from '@/links/linkIndex'
import { tagStyle, themeColor } from '@/theme/palette'

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
  search: 'Search for notes',
  // searchOrCreate: a relation to the Tag type (catalog section 5)
  searchOrCreate: 'Search or Create',
  nothingFound: 'Nothing found',
  nothingToSelect: 'This set has nothing to pick from. Search everything to add notes to it.',
  editProperty: 'Edit Property',
  /** Item 22's Tag row, and M29's create rows (one per type). */
  create: (q: string) => `Create '${q}'`,
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

/** The basic Tag type. */
export function isTagType(type: TypeDef | undefined): boolean {
  return !!type?.basic && type.name.toLowerCase() === 'tag'
}

/**
 * "Search for objects": the objects of the property's allowed types (only the fixed set, under
 * "Selection set", when there is one). Two objects with the same title show their folder.
 * Values are `EntityRef`s with the picked object's path.
 *
 * Item 22, a relation to the Tag type only (Object -> Tag "Status" or "Category"):
 * "Search or Create", each tag a chip in its own colour, and "Create 'x'" makes the Tag object
 * (`api.ensureTag`) and picks it.
 *
 * M29, any other relation without a fixed set: a query that matches no candidate exactly gains
 * "Create '<q>'" rows below the list, one per allowed type (every writable type when any type is
 * allowed), the suggested one first with "Suggested". Picking one creates the object (no
 * `templateId`), adds it to the value and sets the space's last type.
 */
export function RelationPicker({ def, value, onChange, onClose, onOpenSettings }: RelationPickerProps) {
  const objects = useLinkIndex((s) => s.objects)
  const types = useLinkIndex((s) => s.types)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const multi = def.options.isArray ?? true
  const allowedTypes = def.options.allowedTypes
  const allowed = useMemo(() => allowedTypes ?? [], [allowedTypes])
  const tagsOnly = allowed.length === 1 && isTagType(typeOf(allowed[0]))

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

  const isSelected = (o: Pick<ObjectSummary, 'path'>) => value.some((v) => v.path === o.path)
  const pick = (o: Pick<ObjectSummary, 'path' | 'title'>) => {
    const ref: EntityRef = { target: o.title, path: o.path }
    if (multi) {
      onChange(isSelected(o) ? value.filter((v) => v.path !== o.path) : [...value, ref])
      return
    }
    onChange(isSelected(o) ? [] : [ref])
    onClose?.()
  }

  const q = query.trim()
  const canCreate =
    tagsOnly && !def.options.hasFixedSet && q !== '' && !candidates.some((o) => o.title.toLowerCase() === q.toLowerCase())
  // M29: the create rows of any other relation, the suggested type first.
  const exact = q !== '' && candidates.some((o) => o.title.toLowerCase() === q.toLowerCase())
  const createTypes = useMemo(() => {
    if (tagsOnly || def.options.hasFixedSet || !q || exact) return []
    const writable = creatableTypes(types)
    const offered = allowed.length
      ? allowed.map((id) => writable.find((t) => t.id === id)).filter((t): t is TypeDef => !!t)
      : writable
    // A relation's context is its allowed types only: with none (any type), not the active tab's
    // collection or query, which says nothing about what this relation points at.
    const first = suggestFor(q, offered, { allowed, scope: [] })[0]
    const top = offered.find((t) => t.id === first)
    const rest = offered.filter((t) => t !== top).map((t) => ({ t, suggested: false }))
    return top ? [{ t: top, suggested: true }, ...rest] : rest
  }, [tagsOnly, def.options.hasFixedSet, q, exact, types, allowed])
  const createOf = async (t: TypeDef) => {
    if (creating) return
    setCreating(true)
    try {
      const { path } = await createTitled(t, q)
      setQuery('')
      pick({ path, title: q })
    } catch (err) {
      // The object couldn't be made; the query stays so the user can try again.
      showToast(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const create = async () => {
    if (!canCreate || creating) return
    setCreating(true)
    try {
      const { path } = await api.ensureTag(q)
      setQuery('')
      pick({ path, title: q })
    } catch {
      // The tag couldn't be made; the query stays so the user can try again.
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex max-h-[20rem] w-72 flex-col">
      <div className="border-b border-line p-1.5">
        <input
          aria-label={tagsOnly ? RELATION_PICKER_TEXT.searchOrCreate : RELATION_PICKER_TEXT.search}
          placeholder={tagsOnly ? RELATION_PICKER_TEXT.searchOrCreate : RELATION_PICKER_TEXT.search}
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            if (shown[0]) {
              e.preventDefault()
              pick(shown[0])
            } else if (canCreate) {
              e.preventDefault()
              void create()
            } else if (createTypes[0]) {
              e.preventDefault()
              void createOf(createTypes[0].t)
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
              {tagsOnly ? (
                <span
                  data-tag-chip={themeColor(o.color)}
                  className="min-w-0 truncate rounded-md px-1.5 py-[1px] text-[13px]"
                  style={tagStyle(o.color)}
                >
                  {o.title}
                </span>
              ) : (
                <>
                  <span className="shrink-0 text-fg-muted">
                    <IconOrEmoji icon={o.icon ?? type?.icon ?? null} size={14} fallback="ph-file-text" />
                  </span>
                  <span className="min-w-0 truncate text-fg">{o.title}</span>
                </>
              )}
              {dup && <span className="min-w-0 truncate text-[12px] text-fg-muted">{folderOf(o.path)}</span>}
              {selected && (
                <span className="ml-auto shrink-0 text-fg-muted">
                  <Icon name="ph-check" size={14} />
                </span>
              )}
            </div>
          )
        })}
        {canCreate && (
          <div
            role="option"
            aria-selected={false}
            tabIndex={-1}
            onClick={() => void create()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create()
            }}
            className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[14px] text-fg hover:bg-hover"
          >
            <Icon name="ph-plus" size={14} />
            {RELATION_PICKER_TEXT.create(q)}
          </div>
        )}
        {shown.length === 0 && !canCreate && (
          <p className="px-2 py-1 text-[13px] text-fg-muted">
            {def.options.hasFixedSet && candidates.length === 0
              ? RELATION_PICKER_TEXT.nothingToSelect
              : RELATION_PICKER_TEXT.nothingFound}
          </p>
        )}
      </div>
      {createTypes.length > 0 && (
        <div data-create-rows="" className="max-h-[8rem] shrink-0 overflow-y-auto border-t border-line p-1">
          {createTypes.map(({ t, suggested }) => (
            <button
              key={t.id}
              type="button"
              disabled={creating}
              data-create-type={t.id}
              onClick={() => void createOf(t)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[14px] text-fg hover:bg-hover"
            >
              <TypeChip type={t} size={18} />
              <span className="min-w-0 flex-1 truncate">{RELATION_PICKER_TEXT.create(q)}</span>
              <span className="shrink-0 text-[12px] text-fg-muted">{typeLabel(t)}</span>
              {suggested && (
                <span className="shrink-0 rounded bg-hover px-1.5 text-[12px] text-fg-muted">{SUGGEST_TEXT.suggested}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {onOpenSettings && (
        <div data-type-setting="" className="border-t border-line p-1">
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
