/**
 * The picker the "Existing object" and "New object" tools open. "Existing object": a command
 * list over `host.objects()` filtered by title ("Search objects", our string); Enter or a click
 * picks. "New object": the space's types ("Pick a type", our string); picking one creates an
 * object of that type through `host.createObject` and picks it. Escape closes. With `typeId`
 * (M8, the quick-create menu's "Link {name}") only objects of that type are listed.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ObjectSummary, TypeDef } from '@/api/types'
import { IconOrEmoji } from '@/components/Icon'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { typeOf, useLinkIndex } from '@/links/linkIndex'
import type { ObjectPickerProps } from '../canvasTypes'
import { WB } from '../strings'

/** How many objects the list shows at once. */
export const PICKER_LIMIT = 50

/** Our string. */
export const NOTHING_FOUND = 'Nothing found'

const byPluralName = (a: TypeDef, b: TypeDef) => a.pluralName.localeCompare(b.pluralName, undefined, { sensitivity: 'base' })

export function ObjectPicker({ mode, typeId, host, onPick, onClose }: ObjectPickerProps) {
  const types = useLinkIndex((s) => s.types)
  const [query, setQuery] = useState('')
  const [objects, setObjects] = useState<ObjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (mode !== 'link') return
    let live = true
    host
      .objects()
      .then((list) => live && setObjects(list))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [mode, host])

  const needle = query.trim().toLowerCase()
  const foundObjects = useMemo(() => {
    if (!objects) return []
    return objects
      .filter((o) => !typeId || o.type === typeId)
      .filter((o) => !needle || o.title.toLowerCase().includes(needle))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
      .slice(0, PICKER_LIMIT)
  }, [objects, needle, typeId])
  const foundTypes = useMemo(
    () =>
      [...types]
        .sort(byPluralName)
        .filter((t) => !needle || t.name.toLowerCase().includes(needle) || t.pluralName.toLowerCase().includes(needle)),
    [types, needle],
  )

  const create = async (typeId: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const path = await host.createObject(typeId)
      onPick({ path })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'link' ? WB.toolLink.text : WB.toolCreate.text
  return (
    <div
      data-whiteboard-object-picker=""
      role="dialog"
      aria-label={title}
      className="w-[min(420px,calc(100vw-32px))] overflow-hidden rounded-xl border border-line bg-raised-2 text-fg shadow-xl"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <Command shouldFilter={false} className="bg-transparent">
        <CommandInput
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder={mode === 'link' ? WB.searchObjects.text : WB.pickType.text}
          aria-label={mode === 'link' ? WB.searchObjects.text : WB.pickType.text}
        />
        <CommandList className="max-h-80">
          {mode === 'link' ? (
            <>
              {objects && foundObjects.length === 0 && <CommandEmpty>{NOTHING_FOUND}</CommandEmpty>}
              <CommandGroup>
                {foundObjects.map((o) => {
                  const type = typeOf(o.type)
                  return (
                    <CommandItem key={o.path} value={o.path} onSelect={() => onPick({ path: o.path })}>
                      <IconOrEmoji icon={o.icon ?? type?.icon} fallback="ph-file" size={16} />
                      <span className="flex-1 truncate">{o.title}</span>
                      {type && <span className="text-[12px] text-fg-muted">{type.name}</span>}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </>
          ) : (
            <CommandGroup heading={WB.pickType.text}>
              {foundTypes.length === 0 && <CommandEmpty>{NOTHING_FOUND}</CommandEmpty>}
              {foundTypes.map((t) => (
                <CommandItem key={t.id} value={t.id} disabled={busy} onSelect={() => void create(t.id)}>
                  <IconOrEmoji icon={t.icon} fallback="ph-cube" size={16} />
                  <span className="flex-1 truncate">{t.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
      {error && (
        <p role="alert" className="border-t border-line px-3 py-2 text-[13px] text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
