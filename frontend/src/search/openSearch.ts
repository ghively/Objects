/**
 * Open the extended search page ("Open extended search") in the
 * current tab, carrying what was typed and the "Text matches only" toggle.
 * The `search` target is `nav/tabs.ts`' `{kind: 'search', q?, textOnly?}`.
 */
import { useTabs } from '@/nav/tabs'

export interface SearchTarget {
  kind: 'search'
  q?: string
  textOnly?: boolean
}

export function openExtendedSearch(q?: string, textOnly?: boolean): void {
  const target: SearchTarget = { kind: 'search', q, textOnly }
  useTabs.getState().open(target)
}
