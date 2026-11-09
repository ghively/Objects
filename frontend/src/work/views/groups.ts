// The Tasks dashboard's view groups (Gene's redesign): the switcher shows Drive on its own row and
// folds Plan, Manage and Review behind "More views", so the page opens calm on the one card. Views
// not listed here (a later registration) fall into Review, after the listed ones.
import type { WorkViewId } from '@/api/types'
import type { WorkViewDef } from './registry'

export type ViewGroupId = 'drive' | 'plan' | 'manage' | 'review'

export interface ViewGroup {
  id: ViewGroupId
  label: string
  /** The group's views, in order. */
  ids: readonly WorkViewId[]
}

export const VIEW_GROUPS: readonly ViewGroup[] = [
  { id: 'drive', label: 'Drive', ids: ['now', 'list-inbox', 'today', 'queues', 'agent', 'captures'] },
  { id: 'plan', label: 'Plan', ids: ['list-scheduled', 'flow', 'projects', 'floor'] },
  {
    id: 'manage',
    label: 'Manage',
    ids: ['list-status', 'list-open', 'list-deadline', 'list-recurring', 'list-reminders', 'list-source', 'list-tags', 'list-all'],
  },
  { id: 'review', label: 'Review', ids: ['stuck', 'wins', 'alerts', 'tickets', 'everything', 'list-completed'] },
]

/** The group a view belongs to (unlisted: Review). */
export function groupOf(id: WorkViewId): ViewGroupId {
  return VIEW_GROUPS.find((g) => g.ids.includes(id))?.id ?? 'review'
}

/** `views` arranged by group: each group's listed views in order, then unlisted ones in registry order. */
export function groupViews(views: readonly WorkViewDef[]): { group: ViewGroup; views: WorkViewDef[] }[] {
  return VIEW_GROUPS.map((group) => {
    const listed = group.ids.flatMap((id) => views.filter((v) => v.id === id))
    const extra = group.id === 'review' ? views.filter((v) => !VIEW_GROUPS.some((g) => g.ids.includes(v.id))) : []
    return { group, views: [...listed, ...extra] }
  }).filter((g) => g.views.length > 0)
}
