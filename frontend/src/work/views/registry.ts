// M23 Task 9: the Work page's views, in the switcher's order, with their keys and count badges.
// A later milestone adds a view with `registerWorkView` from its own `work/<folder>/registerView.ts`
// (WorkPage loads those through `import.meta.glob`), so no M23 file changes for it.
import type { ComponentType } from 'react'
import type { WorkBoardItem, WorkViewId } from '@/api/types'
import { floorGroups } from '../logic/floor'
import { linkedPaths } from '../logic/focusLines'
import { projectLines } from '../logic/stations'
import { queues } from '../logic/queues'
import { nowPool, type FocusFilter } from '../logic/scoring'
import { stuck } from '../logic/stuck'
import type { WorkDataState } from '../state/useWorkData'
import { focusLineToday, notNowToday, useWorkUi, type WorkUiValues } from '../state/useWorkUi'
import { WORK_ICONS } from '../workIcons'
import { WORK_TEXT } from '../workText'
import { AgentQueueView } from './AgentQueueView'
import { AlertsView } from './AlertsView'
import { EverythingView } from './EverythingView'
import { FloorView } from './FloorView'
import { FlowView } from './FlowView'
import { NowView } from './NowView'
import { ProjectsMapView } from './ProjectsMapView'
import { QueuesView } from './QueuesView'
import { StuckView } from './StuckView'
import { TicketsView } from './TicketsView'
import { TodayWithTasks } from './TodayWithTasks'
import { sectionCount } from '@/tasks/TasksPage'
import { WinsView } from './WinsView'

export interface WorkViewProps {
  data: WorkDataState
  now: Date
}

export interface WorkViewDef {
  id: WorkViewId
  label: string
  icon: string
  /** The key after `g` (null: none). */
  key: string | null
  count(data: WorkDataState, now: Date): number
  Component: ComponentType<WorkViewProps>
}

const items = (data: WorkDataState): WorkBoardItem[] => data.board?.items ?? []
const active = (data: WorkDataState): WorkBoardItem[] => items(data).filter((i) => !i.done)

/**
 * The focus filter of today's selected focus line (null: none selected). A selected line that is
 * not in the data (loading, failed, the list got shorter) filters to nothing, never to unrelated work.
 */
export function focusFilterFor(data: WorkDataState, ui: Pick<WorkUiValues, 'focusLine'>): FocusFilter | null {
  const n = focusLineToday(ui)
  if (n === null) return null
  const line = data.focus?.lines.find((l) => l.n === n)
  return { n, paths: line ? linkedPaths(line, items(data)) : new Set<string>() }
}

/** Now's pool with the page's energy, today's Not now and the selected focus line. */
export function nowPoolOf(
  data: WorkDataState,
  now: Date,
  ui: Pick<WorkUiValues, 'energy' | 'notNow' | 'focusLine'> = useWorkUi.getState(),
): WorkBoardItem[] {
  return nowPool(items(data), { now, energy: ui.energy, notNow: notNowToday(ui), focus: focusFilterFor(data, ui) })
}

/** The default views, in order (spec views table; Tickets has no key). */
export const WORK_VIEWS: WorkViewDef[] = [
  {
    id: 'now',
    label: WORK_TEXT.viewNow,
    icon: WORK_ICONS.focus,
    key: 'n',
    count: (d, now) => nowPoolOf(d, now).length,
    Component: NowView,
  },
  { id: 'flow', label: WORK_TEXT.viewFlow, icon: WORK_ICONS.flow, key: 'w', count: (d) => active(d).length, Component: FlowView },
  {
    id: 'projects',
    label: WORK_TEXT.viewProjects,
    icon: WORK_ICONS.map,
    key: 'p',
    count: (d) => projectLines(items(d)).length,
    Component: ProjectsMapView,
  },
  {
    id: 'today',
    label: WORK_TEXT.viewToday,
    icon: WORK_ICONS.today,
    key: 't',
    // Phase 2: one Today — the day timeline and today's task list; the badge counts today's tasks.
    count: (_d, now) => sectionCount('today', now),
    Component: TodayWithTasks,
  },
  {
    id: 'floor',
    label: WORK_TEXT.viewFloor,
    icon: WORK_ICONS.floor,
    key: 'o',
    count: (d) => floorGroups(items(d), d.general?.items ?? []).open.reduce((n, g) => n + g.rows.length, 0),
    Component: FloorView,
  },
  {
    id: 'queues',
    label: WORK_TEXT.viewQueues,
    icon: WORK_ICONS.queues,
    key: 'q',
    count: (d, now) => Object.values(queues(items(d), now)).reduce((n, q) => n + q.length, 0),
    Component: QueuesView,
  },
  {
    id: 'agent',
    label: WORK_TEXT.viewAgent,
    icon: WORK_ICONS.agent,
    key: 'h',
    count: (d) => d.agent?.carrying ?? 0,
    Component: AgentQueueView,
  },
  {
    id: 'stuck',
    label: WORK_TEXT.viewStuck,
    icon: WORK_ICONS.stuck,
    key: 's',
    count: (d, now) => {
      const s = stuck(items(d), now)
      return s.blocked.length + s.waitingOn.length
    },
    Component: StuckView,
  },
  { id: 'wins', label: WORK_TEXT.viewWins, icon: WORK_ICONS.win, key: 'y', count: (d) => d.wins?.stepsDone ?? 0, Component: WinsView },
  {
    id: 'alerts',
    label: WORK_TEXT.viewAlerts,
    icon: WORK_ICONS.alert,
    key: 'l',
    count: (d) => activeAlerts(d),
    Component: AlertsView,
  },
  {
    id: 'everything',
    label: WORK_TEXT.viewEverything,
    icon: WORK_ICONS.everything,
    key: 'e',
    count: (d) => (d.all ?? d.board)?.items.length ?? 0,
    Component: EverythingView,
  },
  {
    id: 'tickets',
    label: WORK_TEXT.viewTickets,
    icon: WORK_ICONS.ticket,
    key: null,
    count: (d) => active(d).filter((i) => i.ticket).length,
    Component: TicketsView,
  },
]

/** Active alerts that aren't Info (the Alerts badge and the agent pill). */
export function activeAlerts(data: WorkDataState): number {
  return (data.alerts?.alerts ?? []).filter((a) => a.active && a.severity !== 'Info').length
}

let views: WorkViewDef[] = [...WORK_VIEWS]

/** Add a view after the others, or replace the one with its id. */
export function registerWorkView(def: WorkViewDef): void {
  const at = views.findIndex((v) => v.id === def.id)
  views = at >= 0 ? views.map((v, i) => (i === at ? def : v)) : [...views, def]
}

/** Every view, in the switcher's order. */
export function workViews(): WorkViewDef[] {
  return views
}

/** Tests: back to the default views. */
export function resetWorkViews(): void {
  views = [...WORK_VIEWS]
}
