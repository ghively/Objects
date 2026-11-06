// M23 Task 13: the Agent queue. Working on (rows `running`), Queued (rows `pending`, with
// `Not before {time}` when set) and Failed (rows `failed`, the error and Retry), plus the "Agent
// acts on my approvals" switch. Until M24 fills the seam (`available` false) the switch is
// disabled with the status's note, Working on and Failed are empty, and Queued lists the board's
// items whose turn is the agent's (`Waiting for the agent`), so Run now's effect shows.
import { useState, type JSX } from 'react'
import { api } from '@/api/client'
import type { AgentQueueRow, AgentQueueState, WorkBoardItem } from '@/api/types'
import { Switch } from '@/components/ui/switch'
import { formatInZone } from '@/lib/zonedTime'
import { openItemPanel } from '../state/workActions'
import { workToast } from '../state/workToasts'
import { useWorkData, type WorkDataState } from '../state/useWorkData'
import { WORK_TEXT } from '../workText'

const ROW = 'flex min-h-9 min-w-0 items-center gap-2 border-b border-line px-1 py-1 text-[13px]'

function when(iso: string, zone: string | null | undefined): string {
  return formatInZone(iso, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, 'en-US', zone)
}

function problem(e: unknown): void {
  workToast(e instanceof Error && e.message ? e.message : String(e))
}

function Section({ title, children }: { title: string; children: JSX.Element[] }): JSX.Element {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-1">
      <h3 className="text-[12px] font-medium text-fg-muted">
        {title} <span>{children.length}</span>
      </h3>
      <ul className="flex min-w-0 flex-col">{children}</ul>
    </section>
  )
}

function QueueRow({ row, zone, onRetry }: { row: AgentQueueRow; zone: string | undefined; onRetry?: () => void }): JSX.Element {
  return (
    <li data-agent-row={row.id} className={ROW}>
      <button type="button" onClick={() => openItemPanel(row.path)} className="min-w-0 truncate text-left text-fg hover:underline">
        {row.title}
      </button>
      {row.stepText && <span className="min-w-0 flex-1 truncate text-[12px] text-fg-muted">{row.stepText}</span>}
      {row.state === 'pending' && row.notBefore && (
        <span className="shrink-0 text-[12px] text-fg-muted">{WORK_TEXT.notBeforeTime(when(row.notBefore, zone))}</span>
      )}
      {row.state === 'failed' && row.error && (
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--work-critical)]">{row.error}</span>
      )}
      {onRetry && (
        <button type="button" onClick={onRetry} className="h-7 shrink-0 rounded border border-line px-2 text-[12px] text-fg hover:bg-hover">
          {WORK_TEXT.retry}
        </button>
      )}
    </li>
  )
}

function BoardRow({ item }: { item: WorkBoardItem }): JSX.Element {
  return (
    <li data-agent-item={item.path} className={ROW}>
      <button type="button" onClick={() => openItemPanel(item.path)} className="min-w-0 truncate text-left text-fg hover:underline">
        {item.title}
      </button>
      {item.current && <span className="min-w-0 flex-1 truncate text-[12px] text-fg-muted">{item.current.text}</span>}
      <span className="shrink-0 text-[12px] text-[var(--work-agent)]">{WORK_TEXT.waitingForAgent}</span>
    </li>
  )
}

export function AgentQueueView({ data }: { data: WorkDataState; now: Date }): JSX.Element {
  const agent = useWorkData((s) => s.agent) ?? data.agent
  const [busy, setBusy] = useState(false)
  const zone = data.board?.timeZone ?? undefined
  const available = agent?.available === true
  const rows = available ? agent.rows : []
  const of = (state: AgentQueueState) => rows.filter((r) => r.state === state)

  const run = async (call: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      const next = await call()
      useWorkData.setState({ agent: next as WorkDataState['agent'] })
    } catch (e) {
      problem(e)
    } finally {
      setBusy(false)
    }
  }

  const queued: JSX.Element[] = available
    ? of('pending').map((r) => <QueueRow key={r.id} row={r} zone={zone} />)
    : (data.board?.items ?? []).filter((i) => !i.done && i.turn === 'agent').map((i) => <BoardRow key={i.path} item={i} />)

  return (
    <div data-work-view="agent" className="flex min-w-0 flex-col gap-4">
      <label className="flex flex-wrap items-center gap-2 text-[13px] text-fg">
        <Switch
          aria-label={WORK_TEXT.agentActs}
          checked={agent?.actsOnApprovals ?? false}
          disabled={!available || busy}
          onCheckedChange={(on) => void run(() => api.setAgentActs(on))}
        />
        <span>{WORK_TEXT.agentActs}</span>
        {!available && agent?.note && <span className="text-[12px] text-fg-muted">{agent.note}</span>}
      </label>
      <Section title={WORK_TEXT.workingOn}>{of('running').map((r) => <QueueRow key={r.id} row={r} zone={zone} />)}</Section>
      <Section title={WORK_TEXT.queued}>{queued}</Section>
      <Section title={WORK_TEXT.failed}>
        {of('failed').map((r) => (
          <QueueRow key={r.id} row={r} zone={zone} onRetry={() => void run(() => api.retryAgentEntry(r.id))} />
        ))}
      </Section>
    </div>
  )
}
