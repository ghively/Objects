// Customize view > Table: property visibility and text wrapping.
import type { TypeDef, ViewState } from '@/api/types'
import { Icon } from '@/components/Icon'
import { normalizeTableConfig, setAllHidden, setHidden, setWrapAll, tableDefs } from './tableConfig'

export interface TableCustomizePageProps {
  type: TypeDef
  state: ViewState
  onState(next: ViewState): void
}

export function TableCustomizePage({ type, state, onState }: TableCustomizePageProps) {
  const config = normalizeTableConfig(type, state.viewDefinition.tableConfigs?.[type.id])
  const defs = Object.fromEntries(tableDefs(type).map((d) => [d.key, d]))
  const save = (next: typeof config) =>
    onState({ ...state, viewDefinition: { ...state.viewDefinition, tableConfigs: { ...state.viewDefinition.tableConfigs, [type.id]: next } } })
  const cols = config.properties.filter((c) => defs[c.id])
  const shown = cols.filter((c) => !c.isHidden)
  const hidden = cols.filter((c) => c.isHidden)

  const row = (id: string, isHidden: boolean) => {
    const locked = defs[id].type === 'entity_title'
    return (
      <button
        key={id}
        type="button"
        disabled={locked}
        onClick={() => save(setHidden(config, id, !isHidden))}
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover disabled:opacity-60"
      >
        <span className="min-w-0 flex-1 truncate">{defs[id].name}</span>
        <Icon name={isHidden ? 'ph-eye-slash' : 'ph-eye'} size={14} />
      </button>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="px-2 pt-1 text-[12px] text-fg-muted">Property visibility</div>
      <div className="px-2 pt-1 text-[12px] text-fg-muted">Shown in table</div>
      {shown.map((c) => row(c.id, false))}
      {hidden.length > 0 && (
        <>
          <div className="px-2 pt-1 text-[12px] text-fg-muted">Hidden in table</div>
          {hidden.map((c) => row(c.id, true))}
        </>
      )}
      <div className="mt-1 flex gap-1 border-t border-line pt-1">
        <button type="button" onClick={() => save(setAllHidden(config, false))} className="flex-1 rounded-md px-2 py-1 text-[13px] hover:bg-hover">
          Show all in table
        </button>
        <button type="button" onClick={() => save(setAllHidden(config, true))} className="flex-1 rounded-md px-2 py-1 text-[13px] hover:bg-hover">
          Hide all in table
        </button>
      </div>
      <div className="px-2 pt-2 text-[12px] text-fg-muted">Text wrapping</div>
      <div className="flex gap-1 pb-1">
        <button
          type="button"
          aria-pressed={config.wrapAllContent}
          onClick={() => save(setWrapAll(config, true))}
          className="flex-1 rounded-md px-2 py-1 text-[13px] hover:bg-hover aria-pressed:bg-hover"
        >
          Wrap all
        </button>
        <button
          type="button"
          aria-pressed={!config.wrapAllContent}
          onClick={() => save(setWrapAll(config, false))}
          className="flex-1 rounded-md px-2 py-1 text-[13px] hover:bg-hover aria-pressed:bg-hover"
        >
          Wrap none
        </button>
      </div>
    </div>
  )
}
