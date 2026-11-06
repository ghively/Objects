// M23 Task 11: the Tickets view: M22's Tickets query page (`work-tickets`) embedded, so its list,
// board (by Desk status) and table layouts work here.
import type { JSX } from 'react'
import { QueryPage } from '@/queries/QueryPage'
import type { WorkDataState } from '../state/useWorkData'

export function TicketsView(_p: { data: WorkDataState; now: Date }): JSX.Element {
  return (
    <div data-work-view="tickets" className="min-h-0">
      <QueryPage id="work-tickets" />
    </div>
  )
}
