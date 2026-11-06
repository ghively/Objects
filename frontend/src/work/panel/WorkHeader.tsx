// M23 T1 stub: the item panel's work header (T14 fills it). Renders its name.
import type { JSX } from 'react'
import type { ObjectWrites } from '@/object/useObjectWrites'

/** The work header above a work item's page in the side panel (stub). */
export function WorkHeader({ path }: { path: string; work: ObjectWrites['work'] }): JSX.Element | null {
  return (
    <div data-work-stub="WorkHeader" data-path={path}>
      WorkHeader
    </div>
  )
}
