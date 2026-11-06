// M23 Task 15: the keep-on-top page: the selected (or current) focus line, Now's top item with its
// current step, and a brain-dump box. Rendered into the picture-in-picture window (sharing the
// page's stores) and, `standalone`, as the Object window's on-top page `/?mini=work`, which loads
// its own data and follows change events.
import { useEffect, useState, type JSX } from 'react'
import type { TicketInfo } from '@/api/types'
import { Icon } from '@/components/Icon'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { StepActions } from '../components/StepActions'
import { currentLine } from '../logic/focusLines'
import { BrainDumpBar } from '../page/BrainDumpBar'
import { useWorkData, useWorkEvents } from '../state/useWorkData'
import { focusLineToday, useWorkUi } from '../state/useWorkUi'
import { WorkToasts } from '../state/WorkToasts.tsx'
import { nowPoolOf } from '../views/registry'
import { WORK_ICONS } from '../workIcons'
import { WORK_TEXT } from '../workText'

/** The standalone page's data: loaded on mount, then reloaded on change events. */
function StandaloneData(): null {
  useWorkEvents()
  useEffect(() => {
    void useSpaceInfo.getState().ensure()
    void useWorkData.getState().load()
  }, [])
  return null
}

function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** The small always-on-top page: the focus line, Now's top step and a brain-dump box. */
export function WorkMini({ standalone = false }: { standalone?: boolean } = {}): JSX.Element {
  const data = useWorkData()
  const ui = useWorkUi()
  const now = useMinuteClock()
  const items = data.board?.items ?? []
  const lines = data.focus?.lines ?? []
  const top = nowPoolOf(data, now, ui)[0] ?? null
  const n = focusLineToday(ui) ?? currentLine(lines, items, top)
  const line = n === null ? null : (lines.find((l) => l.n === n) ?? null)
  const step = top?.current ?? null

  return (
    <div data-work-mini="" className="flex min-h-full flex-col gap-3 bg-base p-3 text-fg">
      {standalone ? <StandaloneData /> : null}
      {line ? (
        <p className="flex items-center gap-1.5 text-[13px] text-[var(--work-you)]" data-work-mini-focus="">
          <Icon name={WORK_ICONS.focus} size={14} />
          {WORK_TEXT.focusLine(line.n, line.label)}
        </p>
      ) : null}
      {top ? (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <p className="text-[15px] font-semibold">{top.title}</p>
          {step ? <p className="text-[13px] text-fg-muted">{step.text}</p> : null}
          {step ? (
            <StepActions item={top as { path: string; title: string; ticket: TicketInfo | null }} step={step} compact />
          ) : null}
        </div>
      ) : (
        <p className="text-[13px] text-fg-muted">{WORK_TEXT.nothingWaiting}</p>
      )}
      <BrainDumpBar view="keepOnTop" />
      {standalone ? <WorkToasts /> : null}
    </div>
  )
}
