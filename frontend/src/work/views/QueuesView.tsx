// M23 Task 13: Your queues. Four columns (Answer, Do, Approve, Agent running) by the current step,
// each with its count and one card per item: the title, the current step, `+{n} later steps
// waiting` (ported) and the step's inline actions (the Agent column marks an approved step
// `Queued`). Only the current step of an item ever shows, so a later step never offers anything.
// Parked items wait on no one's queue. A card whose action runs vanishes at once (`hidden`).
import type { JSX } from 'react'
import type { WorkBoardItem, WorkStep } from '@/api/types'
import { Chip } from '../components/Chip'
import { StepActions } from '../components/StepActions'
import { queues, type QueueKey } from '../logic/queues'
import { openItemPanel, stepKey } from '../state/workActions'
import { useWorkData, type WorkDataState } from '../state/useWorkData'
import { WORK_ICONS } from '../workIcons'
import { WORK_TEXT } from '../workText'

const COLUMNS: { key: QueueKey; label: string }[] = [
  { key: 'answer', label: WORK_TEXT.queueAnswer },
  { key: 'do', label: WORK_TEXT.queueDo },
  { key: 'approve', label: WORK_TEXT.queueApprove },
  { key: 'agent', label: WORK_TEXT.queueAgent },
]

/** The item's current step: the one step that may offer actions. */
function currentStep(i: WorkBoardItem): WorkStep | null {
  return i.steps.find((s) => s.current) ?? (i.current?.current ? i.current : null)
}

/** Steps after the current one still to do. */
function laterSteps(i: WorkBoardItem, step: WorkStep): number {
  return i.steps.filter((s) => s.n > step.n && s.state !== 'done' && s.state !== 'declined').length
}

function QueueCard({ item, step, agentColumn }: { item: WorkBoardItem; step: WorkStep; agentColumn: boolean }): JSX.Element {
  const later = laterSteps(item, step)
  return (
    <div data-work-card={item.path} className="flex min-w-0 flex-col gap-1.5 rounded border border-line px-2 py-1.5">
      <button
        type="button"
        onClick={() => openItemPanel(item.path)}
        className="truncate text-left text-[13px] font-medium text-fg hover:underline"
      >
        {item.title}
      </button>
      <span data-work-step={step.n} className="line-clamp-3 text-[12px] text-fg-muted">
        {step.text}
      </span>
      {later > 0 && <span className="text-[11px] text-fg-muted">{WORK_TEXT.laterSteps(later)}</span>}
      {agentColumn && step.state === 'approved' && (
        <Chip tone="agent" icon={WORK_ICONS.agent}>
          {WORK_TEXT.queued}
        </Chip>
      )}
      <StepActions item={item} step={step} compact />
    </div>
  )
}

export function QueuesView({ data, now }: { data: WorkDataState; now: Date }): JSX.Element {
  const hidden = useWorkData((s) => s.hidden)
  const items = (data.board?.items ?? []).filter((i) => i.stage !== 'parked' && i.turn !== 'parked')
  const q = queues(items, now)
  return (
    <div data-work-view="queues" className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((c) => {
        const cards: { item: WorkBoardItem; step: WorkStep }[] = []
        for (const item of q[c.key]) {
          const step = currentStep(item)
          if (step && !hidden.has(stepKey(item.path, step.id))) cards.push({ item, step })
        }
        return (
          <section key={c.key} data-queue={c.key} aria-label={c.label} className="flex min-w-0 flex-col gap-2">
            <h3 className="flex items-center gap-2 text-[12px] font-medium text-fg-muted">
              <span>{c.label}</span>
              <span data-queue-count="">{cards.length}</span>
            </h3>
            {cards.map(({ item, step }) => (
              <QueueCard key={item.path} item={item} step={step} agentColumn={c.key === 'agent'} />
            ))}
          </section>
        )
      })}
    </div>
  )
}
