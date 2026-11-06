// M23 Task 11: Everything: every work item (board `all`, loaded on first show) in a sortable table.
// A header click sorts by it (again: reverses), kept in `useWorkUi.everythingSort` (default Score
// descending); the top bar's search filters it (the page passes the board already filtered by
// title, ticket id or area); a row opens the item panel; the shown rows are the `j`/`k` order.
import { useEffect, useMemo, type JSX } from 'react'
import { STAGE_LABELS, TURN_LABELS } from '@/api/types'
import { cn } from '@/lib/utils'
import { everythingRows, type EverythingKey } from '../logic/everything'
import { effectivePriority, quietDays, score } from '../logic/scoring'
import { openItemPanel } from '../state/workActions'
import { useWorkData, type WorkDataState } from '../state/useWorkData'
import { useWorkSelection } from '../state/useWorkSelection'
import { useWorkUi } from '../state/useWorkUi'
import { WORK_TEXT } from '../workText'

const COLUMNS: { key: EverythingKey; label: string; numeric?: boolean }[] = [
  { key: 'type', label: WORK_TEXT.colType },
  { key: 'ticketId', label: WORK_TEXT.colTicketId },
  { key: 'title', label: WORK_TEXT.colTitle },
  { key: 'area', label: WORK_TEXT.colArea },
  { key: 'stage', label: WORK_TEXT.colStage },
  { key: 'turn', label: WORK_TEXT.colTurn },
  { key: 'priority', label: WORK_TEXT.colPriority },
  { key: 'quietDays', label: WORK_TEXT.colQuietDays, numeric: true },
  { key: 'score', label: WORK_TEXT.colScore, numeric: true },
]

export function EverythingView({ data, now }: { data: WorkDataState; now: Date }): JSX.Element {
  const sort = useWorkUi((s) => s.everythingSort)
  const setSort = useWorkUi((s) => s.setEverythingSort)
  const index = useWorkSelection((s) => s.index)
  const allLoaded = data.all !== null

  useEffect(() => {
    if (!allLoaded) void useWorkData.getState().load(['all'])
  }, [allLoaded])

  const source = data.all ?? data.board
  const rows = useMemo(
    () => everythingRows(source?.items ?? [], now, sort),
    [source, now, sort],
  )
  const paths = useMemo(() => rows.map((r) => r.path), [rows])

  useEffect(() => {
    useWorkSelection.getState().setList(paths)
  }, [paths])

  const onSort = (key: EverythingKey) =>
    setSort(sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: key === 'score' || key === 'quietDays' ? -1 : 1 })

  return (
    <div data-work-view="everything" className="min-w-0 overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line">
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                className={cn('h-8 px-2 font-medium text-fg-muted', c.numeric ? 'text-right' : 'text-left')}
              >
                <button type="button" onClick={() => onSort(c.key)} className="hover:text-fg">
                  {c.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((i, k) => {
            const p = effectivePriority(i)
            return (
              <tr
                key={i.path}
                data-work-row={i.path}
                data-title={i.title}
                aria-selected={k === index}
                onClick={() => openItemPanel(i.path)}
                className={cn('h-9 cursor-pointer border-b border-line hover:bg-hover', k === index && 'bg-hover')}
              >
                <td className="px-2 text-fg-muted">{i.typeName}</td>
                <td className="px-2 text-fg-muted">{i.ticket?.id ?? ''}</td>
                <td className="max-w-[24rem] truncate px-2 text-fg">{i.title}</td>
                <td className="px-2 text-fg-muted">{i.area ?? ''}</td>
                <td className="px-2 text-fg-muted">{STAGE_LABELS[i.stage]}</td>
                <td className="px-2 text-fg-muted">{TURN_LABELS[i.turn]}</td>
                <td
                  className={cn(
                    'px-2',
                    p === 'Critical' ? 'text-[var(--work-critical)]' : p === 'High' ? 'text-[var(--work-high)]' : 'text-fg-muted',
                  )}
                >
                  {p ?? ''}
                </td>
                <td className="px-2 text-right tabular-nums text-fg-muted">{quietDays(i, now)}</td>
                <td className="px-2 text-right tabular-nums text-fg-muted">{score(i, now)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
