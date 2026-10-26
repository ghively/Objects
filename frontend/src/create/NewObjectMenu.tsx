/**
 * "+ New" (and Ctrl+U): step 1 picks a type ("Search Object Types"), step 2 creates or finds an
 * object of it ("Search or Create"): "New '<q>'" (or "New Untitled") creates one, an existing
 * object opens. Modifier keys pick where it opens (see `createAndOpen`).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { ObjectSummary, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useLinkIndex } from '@/links/linkIndex'
import { ObjectIcon } from '@/object/ObjectHeader'
import { byPluralName, TypeChip } from '@/shell/Sidebar'
import { createAndOpen, openObject, type OpenMods } from './createAndOpen'

export const NEW_OBJECT_TEXT = {
  searchTypes: 'Search Object Types',
  searchOrCreate: 'Search or Create',
  newUntitled: 'New Untitled',
  newNamed: (q: string) => `New '${q}'`,
}

const MAX_RESULTS = 30

export interface NewObjectMenuProps {
  open: boolean
  onOpenChange(open: boolean): void
  /** Start at step 2 with this type. */
  typeId?: string | null
}

type Item =
  | { kind: 'type'; type: TypeDef }
  | { kind: 'new'; label: string }
  | { kind: 'object'; object: ObjectSummary }

function mods(e: MouseEvent | KeyboardEvent): OpenMods {
  return { ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey }
}

export function NewObjectMenu({ open, onOpenChange, typeId: initialTypeId }: NewObjectMenuProps) {
  const types = useLinkIndex((s) => s.types)
  const objects = useLinkIndex((s) => s.objects)
  const [typeId, setTypeId] = useState<string | null>(initialTypeId ?? null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)

  useEffect(() => {
    if (open) {
      setTypeId(initialTypeId ?? null)
      setQuery('')
      setActive(0)
      setError(null)
    }
  }, [open, initialTypeId])

  const type = typeId ? types.find((t) => t.id === typeId) : undefined
  const q = query.trim()

  const items: Item[] = useMemo(() => {
    const needle = q.toLowerCase()
    if (!typeId) {
      return [...types]
        .sort(byPluralName)
        .filter((t) => !needle || t.name.toLowerCase().includes(needle) || t.pluralName.toLowerCase().includes(needle))
        .map((t) => ({ kind: 'type' as const, type: t }))
    }
    const found = objects
      .filter((o) => o.type === typeId && (!needle || o.title.toLowerCase().includes(needle)))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
      .slice(0, MAX_RESULTS)
      .map((o) => ({ kind: 'object' as const, object: o }))
    const create: Item = { kind: 'new', label: q ? NEW_OBJECT_TEXT.newNamed(q) : NEW_OBJECT_TEXT.newUntitled }
    return [create, ...found]
  }, [q, typeId, types, objects])

  const pick = async (item: Item, m: OpenMods) => {
    if (item.kind === 'type') {
      setTypeId(item.type.id)
      setQuery('')
      setActive(0)
      return
    }
    if (item.kind === 'object') {
      onOpenChange(false)
      openObject(item.object.path, m, item.object.type)
      return
    }
    if (!typeId || busy.current) return
    busy.current = true
    try {
      await createAndOpen(typeId, q ? { title: q } : {}, m)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      busy.current = false
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[active]
      if (item) void pick(item, mods(e))
    } else if (e.key === 'Backspace' && !query && typeId && !initialTypeId) {
      setTypeId(null)
      setActive(0)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[20%] w-[min(520px,calc(100vw-32px))] translate-y-0 gap-0 overflow-hidden rounded-xl border-line bg-raised-2 p-0 text-fg"
      >
        <DialogTitle className="sr-only">New object</DialogTitle>
        <DialogDescription className="sr-only">
          {typeId ? NEW_OBJECT_TEXT.searchOrCreate : NEW_OBJECT_TEXT.searchTypes}
        </DialogDescription>
        <div className="flex items-center gap-2 border-b border-line px-3">
          {type ? <TypeChip type={type} size={22} /> : <Icon name="ph-magnifying-glass" size={16} />}
          <input
            autoFocus
            aria-label={typeId ? NEW_OBJECT_TEXT.searchOrCreate : NEW_OBJECT_TEXT.searchTypes}
            placeholder={typeId ? NEW_OBJECT_TEXT.searchOrCreate : NEW_OBJECT_TEXT.searchTypes}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-muted"
          />
        </div>
        {error && (
          <p role="alert" className="px-3 pt-2 text-[13px] text-red-400">
            {error}
          </p>
        )}
        <ul role="listbox" aria-label={type ? type.pluralName : 'Object Types'} className="max-h-[360px] overflow-auto p-1">
          {items.map((item, i) => (
            <li
              key={item.kind === 'type' ? item.type.id : item.kind === 'object' ? item.object.path : 'new'}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={(e) => void pick(item, mods(e))}
              className={cn(
                'flex h-9 cursor-default items-center gap-2 rounded-md px-2 text-[15px]',
                i === active && 'bg-hover',
              )}
            >
              {item.kind === 'type' && (
                <>
                  <TypeChip type={item.type} size={20} />
                  <span className="truncate">{item.type.name}</span>
                </>
              )}
              {item.kind === 'new' && (
                <>
                  <Icon name="ph-plus" size={15} />
                  <span className="truncate">{item.label}</span>
                </>
              )}
              {item.kind === 'object' && (
                <>
                  {item.object.icon ? (
                    <ObjectIcon icon={item.object.icon} size={16} />
                  ) : type ? (
                    <TypeChip type={type} size={20} />
                  ) : null}
                  <span className="truncate">{item.object.title}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
