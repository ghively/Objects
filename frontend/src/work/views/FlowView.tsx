// M23 Task 11: the Flow board. Lanes You / Agent / Others by whose turn it is, columns by stage
// (Done holds the last 14 days only); the Doing header counts Gene's Doing against the limit and
// flags Overloaded; an area filter; stale tiles are dimmed with their quiet days. A tile opens the
// item panel.
import type { JSX } from 'react'
import type { Stage, WorkBoardItem } from '@/api/types'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { Chip, TONE_TEXT } from '../components/Chip'
import { DOING_LIMIT, FLOW_COLUMNS, flowBoard, type Lane } from '../logic/flow'
import { isStale, quietDays } from '../logic/scoring'
import { openItemPanel } from '../state/workActions'
import type { WorkDataState } from '../state/useWorkData'
import { useWorkUi } from '../state/useWorkUi'
import { WORK_ICONS } from '../workIcons'
import { WORK_TEXT } from '../workText'

const LANES: { id: Lane; label: string; icon: string }[] = [
  { id: 'you', label: WORK_TEXT.laneYou, icon: WORK_ICONS.you },
  { id: 'agent', label: WORK_TEXT.laneAgent, icon: WORK_ICONS.agent },
  { id: 'others', label: WORK_TEXT.laneOthers, icon: WORK_ICONS.parked },
]

const COLUMN_LABEL: Record<Stage, string> = {
  notStarted: WORK_TEXT.colNotStarted,
  ready: WORK_TEXT.colReady,
  doing: WORK_TEXT.colDoing,
  parked: WORK_TEXT.colParked,
  done: WORK_TEXT.colDone,
}

function Tile({ item, now }: { item: WorkBoardItem; now: Date }): JSX.Element {
  const stale = isStale(item, now)
  return (
    <button
      type="button"
      data-work-tile={item.path}
      data-stale={stale ? 'true' : undefined}
      onClick={() => openItemPanel(item.path)}
      className={cn(
        'flex w-full min-w-0 flex-col gap-0.5 rounded border border-line px-2 py-1.5 text-left hover:bg-hover',
        stale && 'opacity-60',
      )}
    >
      <span className="truncate text-[13px] text-fg">{item.title}</span>
      {item.ticket?.id && (
        <Chip tone="muted" icon={WORK_ICONS.ticket}>
          {item.ticket.id}
        </Chip>
      )}
      {item.current && <span className="line-clamp-2 text-[12px] text-fg-muted">{item.current.text}</span>}
      {stale && <span className="text-[11px] text-fg-muted">{WORK_TEXT.daysQuiet(quietDays(item, now))}</span>}
    </button>
  )
}

export function FlowView({ data, now }: { data: WorkDataState; now: Date }): JSX.Element {
  const area = useWorkUi((s) => s.flowArea)
  const setArea = useWorkUi((s) => s.setFlowArea)
  const items = data.board?.items ?? []
  const all = flowBoard(items, null, now)
  // A stored area no longer on the board shows everything rather than an empty board.
  const shown = area !== null && all.areas.includes(area) ? area : null
  const { cells, youDoing, overloaded } = shown === null ? all : flowBoard(items, shown, now)

  return (
    <div data-work-view="flow" className="flex min-w-0 flex-col gap-3">
      <label className="flex items-center gap-2 text-[12px] text-fg-muted">
        <span>{WORK_TEXT.colArea}</span>
        <select
          aria-label={WORK_TEXT.colArea}
          value={shown ?? ''}
          onChange={(e) => setArea(e.target.value === '' ? null : e.target.value)}
          className="h-7 rounded border border-line bg-transparent px-2 text-[13px] text-fg"
        >
          <option value="">{WORK_TEXT.allAreas}</option>
          {all.areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[720px] gap-2"
          style={{ gridTemplateColumns: `6rem repeat(${FLOW_COLUMNS.length}, minmax(0, 1fr))` }}
        >
          <div />
          {FLOW_COLUMNS.map((c) => (
            <div key={c} data-flow-column={c} className="flex flex-wrap items-center gap-x-2 text-[12px] font-medium text-fg-muted">
              <span>{COLUMN_LABEL[c]}</span>
              {c === 'doing' && (
                <>
                  <span className={TONE_TEXT.you}>{WORK_TEXT.youDoing(youDoing, DOING_LIMIT)}</span>
                  {overloaded && <Chip tone="critical">{WORK_TEXT.overloaded}</Chip>}
                </>
              )}
            </div>
          ))}
          {LANES.map((lane) => (
            <div key={lane.id} className="contents">
              <div data-tone={lane.id} className={cn('flex items-start gap-1 pt-1.5 text-[13px]', TONE_TEXT[lane.id])}>
                <Icon name={lane.icon} size={14} />
                <span>{lane.label}</span>
              </div>
              {FLOW_COLUMNS.map((c) => (
                <div key={c} data-lane={lane.id} data-column={c} className="flex min-w-0 flex-col gap-1.5">
                  {cells[lane.id][c].map((i) => (
                    <Tile key={i.path} item={i} now={now} />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
