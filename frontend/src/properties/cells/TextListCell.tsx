// M22 `textList` (List): in the panel one line per item; Enter on the add line adds an item, Enter
// on an item moves to the add line, Backspace on an empty item removes it, the handle drags an
// item to a new place. An edited item is saved when it loses focus. In a table the items are
// joined with " · ". Caps: 50 items of one line, 500 characters each.
import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { placeholderFor } from '../format'
import { CELL_TEXT, type CellProps } from './types'

export const MAX_LIST_ITEMS = 50
export const MAX_LIST_ITEM_LENGTH = 500

const clean = (items: readonly string[]) => items.map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t !== '')
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

export function TextListCell({ def, value, readOnly, density, inTable, onChange }: CellProps<string[] | null>) {
  const items = Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : []
  const [draft, setDraft] = useState<string[]>(items)
  const [adding, setAdding] = useState('')
  const committed = useRef<string[]>(items)
  const addRef = useRef<HTMLInputElement>(null)
  const dragged = useRef<number | null>(null)
  const [dropOver, setDropOver] = useState<number | null>(null)
  const key = items.join('\u0000')
  useEffect(() => {
    const next = key === '' ? [] : key.split('\u0000')
    setDraft(next)
    committed.current = next
  }, [key])

  if (density === 'table' || inTable) {
    return (
      <p className={cn('truncate py-0.5 text-[15px]', items.length ? 'text-fg' : 'text-fg-muted')}>
        {items.length ? items.join(' · ') : inTable ? '' : '—'}
      </p>
    )
  }

  if (readOnly) {
    if (items.length === 0) return <p className="py-0.5 text-[15px] text-fg-muted">{placeholderFor(def, density)}</p>
    return (
      <ul className="flex flex-col py-0.5 text-[15px] text-fg">
        {items.map((t, i) => (
          <li key={i} className="truncate">
            {t}
          </li>
        ))}
      </ul>
    )
  }

  const commit = (next: string[]) => {
    const list = clean(next).slice(0, MAX_LIST_ITEMS)
    if (same(list, committed.current)) return
    committed.current = list
    void onChange(list)
  }

  const add = () => {
    const t = adding.replace(/\s+/g, ' ').trim()
    if (!t) return
    setAdding('')
    const next = [...draft, t]
    setDraft(next)
    commit(next)
  }

  const reorder = (from: number, to: number) => {
    if (from === to) return
    const next = [...draft]
    const [moved] = next.splice(from, 1)
    next.splice(from < to ? to - 1 : to, 0, moved)
    setDraft(next)
    commit(next)
  }

  return (
    <div className="flex flex-col gap-0.5 py-0.5">
      {draft.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {draft.map((t, i) => (
            <li
              key={i}
              className={cn('flex items-center gap-1 rounded', dropOver === i && 'ring-1 ring-ring')}
              onDragOver={(e) => {
                if (dragged.current === null) return
                e.preventDefault()
                setDropOver(i)
              }}
              onDragLeave={() => setDropOver((d) => (d === i ? null : d))}
              onDrop={(e) => {
                if (dragged.current === null) return
                e.preventDefault()
                const from = dragged.current
                dragged.current = null
                setDropOver(null)
                reorder(from, i)
              }}
            >
              <button
                type="button"
                draggable
                aria-label="Drag to reorder"
                onDragStart={(e) => {
                  dragged.current = i
                  try {
                    e.dataTransfer?.setData('text/plain', String(i))
                  } catch {
                    // a test's DataTransfer stand-in
                  }
                }}
                onDragEnd={() => {
                  dragged.current = null
                  setDropOver(null)
                }}
                className="flex h-5 w-4 shrink-0 cursor-grab items-center justify-center text-fg-muted opacity-60 hover:opacity-100"
              >
                <Icon name="ph-dots-six-vertical" size={12} />
              </button>
              <input
                aria-label={`Item ${i + 1}`}
                value={t}
                maxLength={MAX_LIST_ITEM_LENGTH}
                onChange={(e) => setDraft(draft.map((x, k) => (k === i ? e.target.value : x)))}
                onBlur={() => commit(draft)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commit(draft)
                    addRef.current?.focus()
                  } else if (e.key === 'Backspace' && t === '') {
                    e.preventDefault()
                    const next = draft.filter((_, k) => k !== i)
                    setDraft(next)
                    commit(next)
                  } else if (e.key === 'Escape') {
                    setDraft(committed.current)
                    e.currentTarget.blur()
                  }
                }}
                className={`${CELL_TEXT} min-w-0 flex-1`}
              />
            </li>
          ))}
        </ul>
      )}
      {draft.length < MAX_LIST_ITEMS && (
        <input
          ref={addRef}
          aria-label="Add item"
          value={adding}
          maxLength={MAX_LIST_ITEM_LENGTH}
          placeholder={draft.length === 0 ? placeholderFor(def, density) : 'Add item'}
          onChange={(e) => setAdding(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            } else if (e.key === 'Escape') {
              setAdding('')
              e.currentTarget.blur()
            }
          }}
          className={`${CELL_TEXT} ${draft.length ? 'pl-5' : ''}`}
        />
      )}
    </div>
  )
}
