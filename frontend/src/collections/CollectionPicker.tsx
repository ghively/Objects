// "Search collections or create one": the picker behind the collections property and
// "Edit Collections". It lists the collections that hold the object's type; values are names.
import { useMemo, useState } from 'react'
import { api } from '@/api/client'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { findByName, useCollections } from './useCollections'

export const COLLECTION_TEXT = {
  placeholder: 'Search collections or create one',
  heading: 'Select Collections',
}

/** "No Collection" / "{n} Collection" / "{n} Collections". */
export function collectionsSummary(n: number): string {
  if (n <= 0) return 'No Collection'
  return n === 1 ? '1 Collection' : `${n} Collections`
}

export interface CollectionPickerProps {
  /** The object's `collections:` names. */
  value: string[]
  /** The object's type: only collections holding it are offered. */
  typeId: string
  onChange(next: string[]): void
}

export function CollectionPicker({ value, typeId, onChange }: CollectionPickerProps) {
  const { collections, byName } = useCollections()
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mine = useMemo(
    () =>
      collections
        .filter((c) => c.typeIds.includes(typeId))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [collections, typeId],
  )
  const q = query.trim()
  const shown = q ? mine.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) : mine
  const sameAs = (v: string, name: string) => {
    if (v.toLowerCase() === name.toLowerCase()) return true
    const c = byName(name)
    return !!c && byName(v)?.id === c.id
  }
  const isSelected = (name: string) => value.some((v) => sameAs(v, name))
  const canCreate = q !== '' && !findByName(collections, q)

  const toggle = (name: string) => {
    onChange(isSelected(name) ? value.filter((v) => !sameAs(v, name)) : [...value, name])
  }

  const create = async () => {
    setError(null)
    try {
      const c = await api.createCollection(q, [typeId])
      setQuery('')
      onChange([...value, c.name])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex max-h-[20rem] w-72 flex-col">
      <div className="border-b border-line p-1.5">
        <input
          aria-label="Search collections"
          placeholder={COLLECTION_TEXT.placeholder}
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !q) return
            e.preventDefault()
            const exact = findByName(mine, q)
            if (exact) toggle(exact.name)
            else if (canCreate) void create()
          }}
          className="h-7 w-full rounded bg-transparent px-1.5 text-[14px] text-fg outline-none placeholder:text-fg-muted"
        />
      </div>
      <div role="listbox" aria-label="Collections" aria-multiselectable className="flex-1 overflow-y-auto p-1">
        {shown.map((c) => {
          const on = isSelected(c.name)
          return (
            <div
              key={c.id}
              role="option"
              aria-selected={on}
              tabIndex={-1}
              onClick={() => toggle(c.name)}
              onKeyDown={(e) => e.key === 'Enter' && toggle(c.name)}
              className="flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-[14px] hover:bg-hover"
            >
              <IconOrEmoji icon={c.icon} fallback="ph-stack" size={15} />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {on && <Icon name="ph-check" size={14} />}
            </div>
          )
        })}
        {shown.length === 0 && !canCreate && <p className="px-2 py-1.5 text-[13px] text-fg-muted">No collections</p>}
        {canCreate && (
          <div
            role="option"
            aria-selected={false}
            tabIndex={-1}
            onClick={() => void create()}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
            className="flex h-8 cursor-pointer items-center gap-2 rounded px-2 text-[14px] hover:bg-hover"
          >
            <Icon name="ph-plus" size={14} />
            {`Create '${q}'`}
          </div>
        )}
        {error && (
          <p role="alert" className="px-2 py-1 text-[13px] text-red-400">
            {error}
          </p>
        )}
      </div>
      <div className="border-t border-line px-2.5 py-1.5 text-[12px] text-fg-muted">{collectionsSummary(value.length)}</div>
    </div>
  )
}
