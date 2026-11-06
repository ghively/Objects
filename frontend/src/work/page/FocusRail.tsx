// M23 Task 9: the focus rail: today's focus lines as chips. The current line (the one holding Now's
// top item) is in the you tone; a cleared line is struck through and muted. Clicking a chip
// selects it and shows Now (only that line's work); clicking it again clears the selection.
import { useState, type JSX } from 'react'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { currentLine, isCleared } from '../logic/focusLines'
import type { WorkDataState } from '../state/useWorkData'
import { focusLineToday, useWorkUi } from '../state/useWorkUi'
import { nowPoolOf } from '../views/registry'
import { WORK_ICONS } from '../workIcons'
import { WORK_TEXT } from '../workText'
import { FocusEditor } from './FocusEditor'

/** The rail's name (ours; not in `WORK_TEXT` yet, kept here until the review). */
const FOCUS_RAIL_LABEL = 'Focus lines'

const BTN = 'h-7 rounded border border-line px-2 text-[12px] text-fg-muted hover:bg-hover'

export function FocusRail({ data, now }: { data: WorkDataState; now: Date }): JSX.Element {
  const ui = useWorkUi()
  const [editing, setEditing] = useState(false)
  const lines = data.focus?.lines ?? []
  const items = data.board?.items ?? []
  const selected = focusLineToday(ui)
  const top = nowPoolOf(data, now, ui)[0] ?? null
  const current = currentLine(lines, items, top)
  const cleared = lines.filter((l) => isCleared(l, items)).length

  const pick = (n: number) => {
    if (selected === n) {
      ui.setFocusLine(null)
      return
    }
    ui.setFocusLine(n)
    if (ui.calm) return
    ui.setView('now')
  }

  if (editing) return <FocusEditor focus={data.focus} onClose={() => setEditing(false)} />

  return (
    <div role="group" aria-label={FOCUS_RAIL_LABEL} className="flex flex-wrap items-center gap-2">
      <Icon name={WORK_ICONS.focus} size={14} className="text-fg-muted" />
      {lines.length === 0 ? <span className="text-[12px] text-fg-muted">{WORK_TEXT.noFocusLines}</span> : null}
      {lines.map((l) => {
        const done = isCleared(l, items)
        const isCurrent = !done && l.n === current
        return (
          <button
            key={l.n}
            type="button"
            data-focus-line={l.n}
            data-current={isCurrent ? '' : undefined}
            data-cleared={done ? '' : undefined}
            data-tone={isCurrent ? 'you' : 'muted'}
            aria-pressed={selected === l.n}
            onClick={() => pick(l.n)}
            className={cn(
              'h-7 max-w-[24rem] truncate rounded border border-line px-2 text-[12px] hover:bg-hover',
              isCurrent ? 'text-[var(--work-you)]' : 'text-fg',
              done && 'text-fg-muted line-through',
              selected === l.n && 'border-[var(--work-you)]',
            )}
          >
            {WORK_TEXT.focusLine(l.n, l.label)}
          </button>
        )
      })}
      {cleared > 0 ? <span className="text-[12px] text-fg-muted">{WORK_TEXT.focusClearedCount(cleared, lines.length)}</span> : null}
      <button type="button" className={BTN} onClick={() => setEditing(true)}>
        {WORK_TEXT.edit}
      </button>
    </div>
  )
}
