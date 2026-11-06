// M22 `floorItems`: in the panel rows "place | what" with a checkbox (ticking collects the item,
// un-ticking puts it back), a "What you found" box on a collected item, Remove, and an add row
// (Place, What). Every change runs through `CellExtras.onWorkWrite` → `api.workFloor`; without it
// (a table, a card) the rows are read-only. In a table "{collected}/{N} collected". A ticked box
// shows at once and goes back when the write fails; an item that changed meanwhile
// (`StepChangedError`, shown by the writer) reloads the item's floor items.
import { useEffect, useState } from 'react'
import { api, StepChangedError } from '@/api/client'
import type { FloorItemValue, FloorOp } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { CellExtras } from '../cellFor'
import { placeholderFor } from '../format'
import { CELL_TEXT, type CellProps } from './types'

export const MAX_FLOOR_ITEMS = 50

/** "place | what" (either alone when the other is empty). */
export const floorLabel = (f: Pick<FloorItemValue, 'place' | 'what'>) => [f.place, f.what].filter(Boolean).join(' | ')

/** The table form: "{collected}/{N} collected" ('' when there are none). */
export function floorSummary(items: readonly FloorItemValue[]): string {
  if (items.length === 0) return ''
  return `${items.filter((f) => !!f.collected).length}/${items.length} collected`
}

function floorFrom(fields: Record<string, unknown> | undefined, key: string, fallback: FloorItemValue[] | undefined) {
  const field = fields?.[key]
  if (Array.isArray(field)) return field as FloorItemValue[]
  return Array.isArray(fallback) ? fallback : null
}

/** Today as `YYYY-MM-DD` (local), for the ticked box shown before the server answers. */
function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface FloorWrite {
  op: FloorOp
  item?: FloorItemValue
  place?: string | null
  what?: string | null
  found?: string | null
}

export function FloorItemsCell({ def, value, readOnly, density, inTable, path, onWorkWrite }: CellProps<FloorItemValue[] | null> & CellExtras) {
  const [shown, setShown] = useState<FloorItemValue[]>(() => (Array.isArray(value) ? value : []))
  useEffect(() => setShown(Array.isArray(value) ? value : []), [value])
  const [place, setPlace] = useState('')
  const [what, setWhat] = useState('')

  if (density === 'table' || inTable) {
    const text = floorSummary(shown)
    return <p className={cn('truncate py-0.5 text-[15px]', text ? 'text-fg' : 'text-fg-muted')}>{text || (inTable ? '' : '—')}</p>
  }

  const canWrite = !readOnly && !!onWorkWrite

  const write = async ({ op, item, ...fields }: FloorWrite, optimistic?: FloorItemValue[]): Promise<boolean> => {
    if (!onWorkWrite) return false
    const prev = shown
    if (optimistic) setShown(optimistic)
    let changed = false
    const res = await onWorkWrite(async (p) => {
      try {
        return await api.workFloor({ path: p, op, itemId: item?.id ?? null, itemRev: item?.rev ?? null, ...fields })
      } catch (e) {
        if (e instanceof StepChangedError) changed = true
        throw e
      }
    })
    if (res) {
      const next = floorFrom(res.item?.fields, def.key, res.item?.floorItems)
      if (next) setShown(next)
      return true
    }
    setShown(prev)
    if (changed && path) {
      try {
        const item = await api.workItem(path)
        const next = floorFrom(item.fields, def.key, item.floorItems)
        if (next) setShown(next)
      } catch {
        // the rows stay as they were
      }
    }
    return false
  }

  const toggle = (f: FloorItemValue, on: boolean) =>
    void write(
      { op: on ? 'collect' : 'uncollect', item: f },
      shown.map((x) => (x.id === f.id ? { ...x, collected: on ? today() : null } : x)),
    )

  const add = () => {
    const p = place.trim()
    const w = what.trim()
    if (!p && !w) return
    setPlace('')
    setWhat('')
    void write({ op: 'add', place: p || null, what: w || null })
  }

  if (!canWrite && shown.length === 0) {
    return <p className="truncate py-0.5 text-[15px] text-fg-muted">{placeholderFor(def, density)}</p>
  }

  return (
    <div className="flex flex-col gap-0.5 py-0.5 text-[15px]">
      {shown.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {shown.map((f) => {
            const label = floorLabel(f)
            return (
              <li key={f.id} className="group flex flex-col">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Checkbox
                    aria-label={label}
                    checked={!!f.collected}
                    disabled={!canWrite}
                    onCheckedChange={(c) => toggle(f, c === true)}
                  />
                  <span className={cn('min-w-0 flex-1 truncate', f.collected ? 'text-fg-muted' : 'text-fg')}>{label}</span>
                  {f.collected && <span className="shrink-0 text-[12px] text-fg-muted">{f.collected}</span>}
                  {canWrite && (
                    <button
                      type="button"
                      aria-label={`Remove ${label}`}
                      onClick={() => void write({ op: 'remove', item: f }, shown.filter((x) => x.id !== f.id))}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-muted opacity-0 hover:bg-hover hover:text-fg focus:opacity-100 group-hover:opacity-100"
                    >
                      <Icon name="ph-x" size={11} />
                    </button>
                  )}
                </div>
                {f.collected &&
                  (canWrite ? (
                    <FoundBox
                      initial={f.found ?? ''}
                      onCommit={(found) => void write({ op: 'edit', item: f, found: found || null })}
                    />
                  ) : (
                    f.found && <p className="ml-6 truncate text-[13px] text-fg-muted">{f.found}</p>
                  ))}
              </li>
            )
          })}
        </ul>
      )}
      {canWrite && shown.length < MAX_FLOOR_ITEMS && (
        <div className="flex items-center gap-1.5">
          <input
            aria-label="Place"
            value={place}
            maxLength={500}
            placeholder="Place"
            onChange={(e) => setPlace(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
            className={`${CELL_TEXT} min-w-0 flex-1`}
          />
          <input
            aria-label="What"
            value={what}
            maxLength={500}
            placeholder="What"
            onChange={(e) => setWhat(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
            className={`${CELL_TEXT} min-w-0 flex-1`}
          />
        </div>
      )}
    </div>
  )
}

/** "What you found" on a collected item: saved on Enter or when it loses focus, if changed. */
function FoundBox({ initial, onCommit }: { initial: string; onCommit(found: string): void }) {
  const [text, setText] = useState(initial)
  useEffect(() => setText(initial), [initial])
  const commit = () => {
    const t = text.trim()
    if (t !== initial.trim()) onCommit(t)
  }
  return (
    <input
      aria-label="What you found"
      value={text}
      maxLength={8000}
      placeholder="What you found"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      className={`${CELL_TEXT} ml-6 text-[13px]`}
    />
  )
}
