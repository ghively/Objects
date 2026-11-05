// M13 contract stub: the "Sub-items and dependencies" page of Customize view (our page). Lane Ti
// fills this file (see docs/superpowers/plans/2026-11-05-m13-view-layouts.md): "Turn on
// sub-items" and "Turn on dependencies" call `api.createRelationPair` and then store the pair's
// property keys in `state.viewDefinition.subItemsConfig` / `dependenciesConfig`.
import type { TypeDef, ViewState } from '@/api/types'

export interface RelationPairsPageProps {
  /** The view's one type (the page is offered only on single-type views). */
  type: TypeDef
  state: ViewState
  onState(next: ViewState): void
}

export function RelationPairsPage(_props: RelationPairsPageProps) {
  return <div data-testid="relation-pairs-page" />
}
