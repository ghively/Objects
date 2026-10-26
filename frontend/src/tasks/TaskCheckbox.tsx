// The round task checkbox (`RootTaskCheckbox`): click toggles between "Open" and "Done";
// Ctrl/Cmd-click or the caret opens "Status" with the options grouped by category. It owns no row
// state: it calls `taskActions` and hands the outcome to the owner, which patches its list.
import { useState, type MouseEvent, type SyntheticEvent } from 'react'
import { api } from '@/api/client'
import type { Row, StatusCategory, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { LabelPill } from '@/properties/LabelMenu'
import { lineColor } from '@/theme/palette'
import { categoryOf, firstOptionOf, statusOption, statusOptionsByCategory } from './statusCategory'
import { setStatus, toggleDone, type TaskApi, type TaskOutcome } from './taskActions'

/** `RootTaskCheckbox.menuShortcutWindows`, as plain text. */
const SHORTCUT_HINT = 'Click to toggle between "Open" and "Done".\n\nCtrl-click to open menu for all status options.'

/** Clicks and drags on the checkbox never reach the row or card around it (open, peek, drag). */
const stop = (e: SyntheticEvent) => e.stopPropagation()

export function TaskCheckbox({
  row,
  type,
  onResult,
  taskApi = api,
  className,
}: {
  row: Row
  type: TypeDef | undefined
  onResult?(outcome: TaskOutcome): void
  /** Injected in tests; the real `api` otherwise. */
  taskApi?: TaskApi
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const category: StatusCategory = categoryOf(row, type)
  const done = category === 'done'
  const color = statusOption(row, type)?.color ?? null
  const readOnly = row.summary.readOnly

  const run = async (action: () => Promise<TaskOutcome>) => {
    if (busy) return
    setBusy(true)
    try {
      onResult?.(await action())
    } finally {
      setBusy(false)
    }
  }

  const onClick = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (readOnly) return
    if (e.ctrlKey || e.metaKey) {
      setOpen(true)
      return
    }
    void run(() => toggleDone(taskApi, row, type))
  }

  const pick = (text: string) => {
    setOpen(false)
    void run(() => setStatus(taskApi, row, type, text))
  }

  const openText = firstOptionOf(type, 'not-started')?.text
  const current = statusOption(row, type)?.text

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span
          className={cn('group/check inline-flex shrink-0 items-center', className)}
          onPointerDown={stop}
          onMouseDown={stop}
          onKeyDown={stop}
          onClick={stop}
        >
          <button
            type="button"
            role="checkbox"
            aria-checked={done}
            aria-label={done ? 'Done' : 'Open'}
            title={SHORTCUT_HINT}
            disabled={readOnly || busy}
            data-category={category}
            onClick={onClick}
            className={cn(
              'flex size-[18px] items-center justify-center rounded-full border-[1.5px] transition-colors',
              done ? 'border-transparent text-white' : 'border-fg-muted hover:border-fg',
              category === 'in-progress' && 'border-dashed',
            )}
            style={done ? { backgroundColor: lineColor(color ?? 'green') } : category !== 'not-started' && color ? { borderColor: lineColor(color) } : undefined}
          >
            {done && <Icon name="ph-check-bold" size={11} />}
          </button>
          <button
            type="button"
            aria-label="Status"
            aria-haspopup="menu"
            disabled={readOnly}
            onClick={(e) => {
              e.stopPropagation()
              setOpen((v) => !v)
            }}
            className="ml-0.5 flex h-[18px] w-3 items-center justify-center rounded text-fg-muted opacity-0 hover:text-fg focus-visible:opacity-100 group-hover/check:opacity-100"
          >
            <Icon name="ph-caret-down" size={10} />
          </button>
        </span>
      </PopoverAnchor>
      <PopoverContent align="start" className="w-56 border-line bg-raised p-1.5 text-fg" onClick={stop} onPointerDown={stop}>
        <div role="menu" aria-label="Status" className="flex flex-col gap-1">
          <div className="px-2 pt-1 pb-0.5 text-[12px] font-medium text-fg-muted">Status</div>
          {statusOptionsByCategory(type)
            .filter((g) => g.options.length > 0)
            .map((g) => (
              <div key={g.key} role="group" aria-label={g.label} className="flex flex-col">
                <div className="px-2 py-1 text-[12px] text-fg-muted">{g.label}</div>
                {g.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    role="menuitem"
                    onClick={() => pick(o.text)}
                    className={cn('flex h-8 items-center gap-2 rounded-md px-2 text-left hover:bg-hover', o.text === current && 'bg-hover')}
                  >
                    <LabelPill option={o} />
                    {o.text === openText && <span className="ml-auto text-[12px] text-fg-muted">Open</span>}
                  </button>
                ))}
              </div>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
