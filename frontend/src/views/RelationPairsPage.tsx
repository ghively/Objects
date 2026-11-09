// M13: the "Sub-items and dependencies" page of Customize view (our page, our strings). "Turn on
// sub-items" and "Turn on dependencies" add (or reuse) the type's two-way relation pair through
// `api.createRelationPair`, then store the pair's property keys in the view definition
// (`subItemsConfig` / `dependenciesConfig`). "Turn off" clears only the view's key: the properties
// stay, as ordinary relations with values in the files.
import { useState } from 'react'
import { api, ConflictError } from '@/api/client'
import type { DataViewDefinition, RelationPairKind, RelationPairResult, TypeDef, ViewState } from '@/api/types'
import { Icon } from '@/components/Icon'

export interface RelationPairsPageProps {
  /** The view's one type (the page is offered only on single-type views). */
  type: TypeDef
  state: ViewState
  onState(next: ViewState): void
}

/** Our strings. */
export const RELATION_PAIRS_TEXT = {
  subItems: { title: 'Sub-items', hint: 'Nest items under their parent item.', on: 'Turn on sub-items' },
  dependencies: { title: 'Dependencies', hint: 'Mark items as blocked by other items.', on: 'Turn on dependencies' },
  isOn: 'On',
  off: 'Turn off',
  basic: 'The properties of basic types are fixed.', // the sentence the backend and AddPropertyMenu use
  readOnly: "This type can't be changed.",
  conflict: 'The type changed elsewhere. Try again.',
  failed: 'Could not turn it on.',
} as const

const CONFIG_KEY = { subItems: 'subItemsConfig', dependencies: 'dependenciesConfig' } as const

/** The view definition with the pair's property keys stored (from the server's answer); null if they're missing. */
export function withPair(def: DataViewDefinition, kind: RelationPairKind, res: RelationPairResult): DataViewDefinition | null {
  const key = (id: string) => res.type.propertyDefinitions.find((p) => p.id === id)?.key
  const first = key(res.firstId)
  const second = key(res.secondId)
  if (!first || !second) return null
  return kind === 'subItems'
    ? { ...def, subItemsConfig: { parentPropertyId: first, childrenPropertyId: second } }
    : { ...def, dependenciesConfig: { blockedByPropertyId: first, blockingPropertyId: second } }
}

/** Whether the view's stored pair still names two properties of the type. */
export function pairIsOn(type: TypeDef, def: DataViewDefinition, kind: RelationPairKind): boolean {
  const keys =
    kind === 'subItems'
      ? [def.subItemsConfig?.parentPropertyId, def.subItemsConfig?.childrenPropertyId]
      : [def.dependenciesConfig?.blockedByPropertyId, def.dependenciesConfig?.blockingPropertyId]
  return keys.every((k) => !!k && type.propertyDefinitions.some((p) => p.key === k))
}

export function RelationPairsPage({ type, state, onState }: RelationPairsPageProps) {
  const [busy, setBusy] = useState<RelationPairKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const blocked = type.basic ? RELATION_PAIRS_TEXT.basic : type.readOnlyReason ? RELATION_PAIRS_TEXT.readOnly : null

  const turnOn = async (kind: RelationPairKind) => {
    setBusy(kind)
    setError(null)
    try {
      const res = await api.createRelationPair(type.id, kind, type.revision)
      const next = withPair(state.viewDefinition, kind, res)
      if (next) onState({ ...state, viewDefinition: next })
      else setError(RELATION_PAIRS_TEXT.failed)
    } catch (err) {
      if (err instanceof ConflictError) setError(RELATION_PAIRS_TEXT.conflict)
      else setError(err instanceof Error && err.message ? err.message : RELATION_PAIRS_TEXT.failed)
    } finally {
      setBusy(null)
    }
  }

  const turnOff = (kind: RelationPairKind) => {
    const next: DataViewDefinition = { ...state.viewDefinition }
    delete next[CONFIG_KEY[kind]]
    onState({ ...state, viewDefinition: next })
  }

  const section = (kind: RelationPairKind) => {
    const text = RELATION_PAIRS_TEXT[kind]
    const on = pairIsOn(type, state.viewDefinition, kind)
    return (
      <div key={kind} data-testid={`relation-pair-${kind}`} className="flex flex-col gap-1 px-2 py-1.5">
        <div className="flex items-center gap-2 text-[14px] text-fg">
          <Icon name={kind === 'subItems' ? 'ph-tree-structure' : 'ph-arrow-bend-down-right'} size={14} />
          <span className="min-w-0 flex-1 truncate">{text.title}</span>
          {on && <span className="text-[12px] text-fg-muted">{RELATION_PAIRS_TEXT.isOn}</span>}
        </div>
        <div className="text-[12px] text-fg-muted">{text.hint}</div>
        {on ? (
          <button type="button" onClick={() => turnOff(kind)} className="h-7 self-start rounded-md border border-line px-2 text-[13px] hover:bg-hover">
            {RELATION_PAIRS_TEXT.off}
          </button>
        ) : (
          <button
            type="button"
            disabled={!!blocked || busy !== null}
            onClick={() => void turnOn(kind)}
            className="h-7 self-start rounded-md border border-line px-2 text-[13px] hover:bg-hover disabled:opacity-60"
          >
            {text.on}
          </button>
        )}
      </div>
    )
  }

  return (
    <div data-testid="relation-pairs-page" className="flex flex-col">
      {section('subItems')}
      {section('dependencies')}
      {blocked && <div className="px-2 pb-1 text-[12px] text-fg-muted">{blocked}</div>}
      {error && (
        <p role="alert" className="px-2 pb-1 text-[13px] text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
