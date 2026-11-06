// M23 T1 stub: the Work page (T9 fills it: top bar, brain-dump bar, focus rail, views). Renders its name.
import type { JSX } from 'react'
import type { WorkViewId } from '@/api/types'

/** The Work section's page, on `view` (stub). */
export function WorkPage({ view }: { view?: WorkViewId }): JSX.Element {
  return (
    <div data-work-stub="WorkPage" data-view={view ?? ''}>
      WorkPage
    </div>
  )
}
