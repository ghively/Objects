import { useState } from 'react'
import { CollectionPicker } from '@/collections/CollectionPicker'
import { useCollections } from '@/collections/useCollections'
import type { EntityRef } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { summaryOf, typeOf, useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { chipStyle } from '@/theme/palette'
import { placeholderFor } from '../format'
import type { CellProps } from './types'

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** A basic media field (`mimeType`, `fileSize`, `url`…): read-only text. */
export function SystemFieldCell({ value }: CellProps<unknown>) {
  return <p className="truncate py-0.5 text-[15px] text-fg-muted">{show(value)}</p>
}

export interface CollectionsCellProps extends CellProps<string[] | null> {
  /** The row's object type: the picker offers only collections that hold it. */
  typeId?: string
}

/** Collections: chips (a click opens the collection) and the picker; writes the `collections:` names. */
export function CollectionsCell({ value, readOnly, density, inTable, typeId, onChange }: CollectionsCellProps) {
  const [open, setOpen] = useState(false)
  const { byName } = useCollections()
  const names = Array.isArray(value) ? value : []
  const table = density === 'table'
  const blank = table || !!inTable
  const editable = !readOnly && !!typeId
  return (
    <div className={`group/collections flex items-center gap-1 py-0.5 ${table ? 'flex-nowrap' : 'flex-wrap'}`}>
      {names.map((name) => {
        const c = byName(name)
        return (
          <span
            key={name}
            className={`inline-flex shrink-0 items-center rounded-md bg-hover-2 ${table ? 'text-[12px]' : 'text-[13px]'} ${c ? '' : 'opacity-60'}`}
          >
            <button
              type="button"
              disabled={!c}
              onClick={() => c && useTabs.getState().open({ kind: 'collection', id: c.id })}
              className="px-1.5 py-[1px]"
            >
              {name}
            </button>
            {editable && (
              <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => onChange(names.filter((n) => n !== name))}
                className="flex h-4 w-4 items-center justify-center rounded opacity-0 group-hover/collections:opacity-70 hover:opacity-100 focus-visible:opacity-100"
              >
                <Icon name="ph-x" size={10} />
              </button>
            )}
          </span>
        )
      })}
      {names.length === 0 && !editable && !blank && <span className="text-[15px] text-fg-muted">—</span>}
      {editable && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Edit Collections"
              className={`flex items-center gap-1 rounded px-1 text-[15px] text-fg-muted hover:bg-hover hover:text-fg ${blank && names.length === 0 ? 'min-w-0 flex-1 self-stretch' : ''}`}
            >
              {names.length === 0 ? (blank ? null : 'Add to a collection') : <Icon name="ph-plus" size={14} />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto border-line bg-raised p-0 text-fg">
            <CollectionPicker value={names} typeId={typeId} onChange={onChange} />
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

/**
 * Backlinks (`entity_backlinks`, read-only): the objects linking to this one as link chips, like a
 * read-only relation. A click peeks the object with the backlinks as the pager list; Ctrl/Cmd+click
 * opens it in a tab. "Empty" (the description, else "Empty") when none; in a one-line table cell
 * (`density: 'table'`), where chips don't fit, the value shown is the count.
 */
export function BacklinksCell({ def, value, density, inTable }: CellProps<unknown>) {
  // Re-render when summaries load or change.
  useLinkIndex((s) => s.revision)
  if (typeof value === 'number') return <p className="py-0.5 text-[15px] text-fg-muted">{value}</p>
  const refs = Array.isArray(value) ? (value as (EntityRef | null)[]).filter((r): r is EntityRef => !!r && typeof r === 'object') : []
  const table = density === 'table'
  if (table) return <p className="py-0.5 text-[15px] text-fg-muted">{refs.length || ''}</p>
  if (refs.length === 0) {
    return <p className="py-0.5 text-[15px] text-fg-muted">{placeholderFor(def, inTable ? 'table' : density)}</p>
  }
  const list = refs.map((r) => r.path).filter((p): p is string => !!p)
  return (
    <div className="py-0.5">
      <span className="flex flex-wrap gap-1">
        {refs.map((ref, i) => {
          const summary = ref.path ? summaryOf(ref.path) : undefined
          const type = typeOf(summary?.type)
          const title = summary?.title || ref.target
          return (
            <span
              key={`${ref.path ?? ref.target}-${i}`}
              role={ref.path ? 'link' : undefined}
              data-testid="backlink-chip"
              onClick={(e) => {
                if (!ref.path) return
                e.stopPropagation()
                if (e.ctrlKey || e.metaKey) useTabs.getState().open({ kind: 'object', path: ref.path })
                else usePeek.getState().peek(ref.path, list)
              }}
              className={`inline-flex max-w-full cursor-pointer items-center gap-1 truncate rounded-md px-1.5 py-[1px] text-[13px] ${
                ref.path ? 'bg-[var(--chip-bg)] text-[var(--chip-fg)]' : 'text-fg-muted line-through'
              }`}
              style={chipStyle(type?.color)}
            >
              {ref.path && <IconOrEmoji icon={summary?.icon ?? type?.icon ?? null} size={12} fallback="ph-file-text" />}
              <span className="truncate">{title}</span>
            </span>
          )
        })}
      </span>
    </div>
  )
}
