/**
 * Open the extended search page ("Open extended search", `LocalSpaceQuery.openSearch`) in the
 * current tab, carrying what was typed and the "Text matches only" toggle.
 *
 * Task 3 owns the `search` target in `nav/tabs.ts`; until its `Target` union carries
 * `{kind: 'search', q?, textOnly?}` the target is cast here.
 */
import { useTabs, type Target } from '@/nav/tabs'

export interface SearchTarget {
  kind: 'search'
  q?: string
  textOnly?: boolean
}

export function openExtendedSearch(q?: string, textOnly?: boolean): void {
  const target: SearchTarget = { kind: 'search', q, textOnly }
  useTabs.getState().open(target as unknown as Target)
}
