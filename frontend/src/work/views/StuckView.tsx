// M23 Task 13: Stuck. Blocked and quiet for 7+ days (`{n} days quiet` and Blocked on), Waiting on
// someone (the people Blocked on links, as links to their pages) and Failed agent runs (M24's
// queue rows; the section is hidden while the agent is unavailable). Empty: `Nothing is stuck`.
import type { JSX } from 'react'
import type { AgentQueueRow, WorkBoardItem } from '@/api/types'
import { useTabs } from '@/nav/tabs'
import { quietDays } from '../logic/scoring'
import { stuck } from '../logic/stuck'
import { openItemPanel } from '../state/workActions'
import { useWorkData, type WorkDataState } from '../state/useWorkData'
import { WORK_TEXT } from '../workText'

const ROW = 'flex min-h-9 min-w-0 flex-wrap items-center gap-x-2 border-b border-line px-1 py-1 text-[13px]'

/** Blocked on's text with `[[a|b]]` shown as `b` and `[[a]]` as `a`. */
function plain(text: string): string {
  return text.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2').replace(/\[\[([^\]]*)\]\]/g, '$1')
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

function Title({ path, title }: { path: string; title: string }): JSX.Element {
  return (
    <button type="button" onClick={() => openItemPanel(path)} className="min-w-0 truncate text-left text-fg hover:underline">
      {title}
    </button>
  )
}

function BlockedRow({ item, now }: { item: WorkBoardItem; now: Date }): JSX.Element {
  return (
    <li data-stuck={item.path} className={ROW}>
      <Title path={item.path} title={item.title} />
      <span className="shrink-0 text-[12px] text-fg-muted">{WORK_TEXT.daysQuiet(quietDays(item, now))}</span>
      {item.blockedOn && (
        <span className="min-w-0 flex-1 truncate text-[12px] text-fg-muted">
          {WORK_TEXT.blockedOn}: {plain(item.blockedOn)}
        </span>
      )}
    </li>
  )
}

function WaitingRow({ item }: { item: WorkBoardItem }): JSX.Element {
  return (
    <li data-stuck={item.path} className={ROW}>
      <Title path={item.path} title={item.title} />
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12px] text-fg-muted">
        {item.blockedOnPeople.map((p) => (
          <button
            key={p.path}
            type="button"
            onClick={() => useTabs.getState().openInSidepanel({ kind: 'object', path: p.path })}
            className="text-[var(--work-you)] hover:underline"
          >
            {p.title}
          </button>
        ))}
      </span>
    </li>
  )
}

function FailedRow({ row }: { row: AgentQueueRow }): JSX.Element {
  return (
    <li data-agent-row={row.id} className={ROW}>
      <Title path={row.path} title={row.title} />
      {row.stepText && <span className="min-w-0 truncate text-[12px] text-fg-muted">{row.stepText}</span>}
      {row.error && <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--work-critical)]">{row.error}</span>}
    </li>
  )
}

export function StuckView({ data, now }: { data: WorkDataState; now: Date }): JSX.Element {
  const agent = useWorkData((s) => s.agent) ?? data.agent
  const { blocked, waitingOn } = stuck(data.board?.items ?? [], now)
  const failed = agent?.available ? agent.rows.filter((r) => r.state === 'failed') : null
  const nothing = !blocked.length && !waitingOn.length && !failed?.length

  return (
    <div data-work-view="stuck" className="flex min-w-0 flex-col gap-4">
      {nothing && <p className="text-[13px] text-fg-muted">{WORK_TEXT.nothingStuck}</p>}
      <Section title={WORK_TEXT.blockedQuiet}>{blocked.map((i) => <BlockedRow key={i.path} item={i} now={now} />)}</Section>
      <Section title={WORK_TEXT.waitingOnSomeone}>{waitingOn.map((i) => <WaitingRow key={i.path} item={i} />)}</Section>
      {failed && <Section title={WORK_TEXT.failedRuns}>{failed.map((r) => <FailedRow key={r.id} row={r} />)}</Section>}
    </div>
  )
}
