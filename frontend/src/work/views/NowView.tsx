// M23 Task 10: the Now view (spec views table, Now row): the card for the best item on Gene's turn
// (`nowPool`: energy, today's Not now, the selected focus line, never a fallback for a focus line)
// beside the side column. A row whose action runs vanishes at once (`hidden`). With nothing to
// show: `Nothing is waiting on you`, or for a selected focus line `Focus {n} cleared`, `No work is
// linked to this focus line yet.` (ported) or `Nothing in focus {n} is waiting on you.` (ours),
// each with Show everything again (ported).
import type { JSX } from 'react'
import type { WorkBoardItem } from '@/api/types'
import { isCleared } from '../logic/focusLines'
import { useWorkData, type WorkDataState } from '../state/useWorkData'
import { focusLineToday, useWorkUi } from '../state/useWorkUi'
import { stepKey } from '../state/workActions'
import { WORK_TEXT } from '../workText'
import { closeKey, currentStepOf, NowCard } from './NowCard'
import { NowSide } from './NowSide'
import { focusFilterFor, nowPoolOf } from './registry'

function Empty({ data }: { data: WorkDataState }): JSX.Element {
  const ui = useWorkUi()
  const n = focusLineToday(ui)
  const line = n === null ? undefined : data.focus?.lines.find((l) => l.n === n)
  const filter = focusFilterFor(data, ui)
  let text: string = WORK_TEXT.nothingWaiting
  if (line && filter) {
    const items = data.board?.items ?? []
    if (isCleared(line, items)) text = WORK_TEXT.focusCleared(line.n)
    else if (filter.paths.size === 0) text = WORK_TEXT.focusLinksNothing
    else text = WORK_TEXT.focusNothingYours(line.n)
  }
  return (
    <div data-now-empty="" className="flex flex-col items-start gap-3 rounded-lg border border-line p-6">
      <p className="text-[15px] text-fg">{text}</p>
      {n !== null ? (
        <button
          type="button"
          className="h-7 rounded border border-line px-2 text-[12px] text-fg hover:bg-hover"
          onClick={() => ui.setFocusLine(null)}
        >
          {WORK_TEXT.showEverythingAgain}
        </button>
      ) : null}
    </div>
  )
}

export function NowView({ data, now }: { data: WorkDataState; now: Date }): JSX.Element {
  const hidden = useWorkData((s) => s.hidden)
  const ui = useWorkUi()
  const isHidden = (i: WorkBoardItem) => {
    if (hidden.has(closeKey(i.path))) return true
    const step = currentStepOf(i)
    return !!step && hidden.has(stepKey(i.path, step.id))
  }
  const pool = nowPoolOf(data, now, ui).filter((i) => !isHidden(i))
  const top = pool[0] ?? null
  return (
    <div data-work-view="now" className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
      <div className="min-w-0">{top ? <NowCard key={top.path} item={top} now={now} /> : <Empty data={data} />}</div>
      <NowSide data={data} now={now} pool={pool} />
    </div>
  )
}
