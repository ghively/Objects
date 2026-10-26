// The menu a table header opens: Sort, Filter, Calculate, Hide, Wrap, Pin and Edit Property.
import { useState, type ReactNode } from 'react'
import type { PropertyDef, TableViewConfig, ViewState } from '@/api/types'
import { Icon } from '@/components/Icon'
import { CALC_KINDS, CALC_LABELS } from '../calc'
import { filterOptionsFor } from '../filter'
import { newFilter } from '../FilterEditor'
import type { PropChoice } from '../properties'
import { SORT_OPTIONS } from '../sort'
import { isWrapped, setHidden, setPinnedThrough, setWrap, visibleColumns } from './tableConfig'

export interface ColumnMenuProps {
  def: PropertyDef
  typeId: string
  state: ViewState
  onState(next: ViewState): void
  config: TableViewConfig
  onConfig(next: TableViewConfig): void
  onClose(): void
  /** "Edit Property": opens the property's settings; absent when the type can't be edited. */
  onEditProperty?(): void
}

function Item({ icon, children, onClick, trailing }: { icon: string; children: ReactNode; onClick(): void; trailing?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover">
      <Icon name={icon} size={15} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </button>
  )
}

export function ColumnMenu({ def, typeId, state, onState, config, onConfig, onClose, onEditProperty }: ColumnMenuProps) {
  const [calc, setCalc] = useState(false)
  const choice: PropChoice = { key: def.key, name: def.name, kind: def.type, def }
  const sortOptions = SORT_OPTIONS(def.type)
  const canFilter = filterOptionsFor(def).length > 0
  const calcs = state.viewDefinition.calculations ?? []
  const current = calcs.find((c) => c.propertyId === def.key)
  const kinds = CALC_KINDS(def.type)
  const col = config.properties.find((c) => c.id === def.key)
  const isTitle = def.type === 'entity_title'
  const visible = visibleColumns(config)
  const pinnedThrough = config.pinnedColumnIndex !== undefined ? visible[config.pinnedColumnIndex]?.id : undefined
  const isPinHere = pinnedThrough === def.key
  const wrapped = isWrapped(config, def.key)

  const done = (next: ViewState) => {
    onState(next)
    onClose()
  }

  if (calc) {
    return (
      <div className="flex w-56 flex-col p-1">
        <button
          type="button"
          onClick={() => setCalc(false)}
          className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-[14px] font-medium hover:bg-hover"
        >
          <Icon name="ph-caret-left" size={14} />
          Calculate
        </button>
        {current && (
          <Item
            icon="ph-x"
            onClick={() => done({ ...state, viewDefinition: { ...state.viewDefinition, calculations: calcs.filter((c) => c !== current) } })}
          >
            None
          </Item>
        )}
        {kinds.map((k) => (
          <Item
            key={k}
            icon="ph-sigma"
            trailing={current?.kind === k ? <Icon name="ph-check" size={13} /> : undefined}
            onClick={() =>
              done({
                ...state,
                viewDefinition: {
                  ...state.viewDefinition,
                  calculations: [...calcs.filter((c) => c.propertyId !== def.key), { propertyId: def.key, structureId: typeId, kind: k }],
                },
              })
            }
          >
            {CALC_LABELS.full[k] ?? k}
          </Item>
        ))}
      </div>
    )
  }

  return (
    <div className="flex w-56 flex-col p-1" data-testid="column-menu">
      {sortOptions.length > 0 && (
        <Item
          icon="ph-sort-ascending"
          onClick={() => {
            const at = state.sorts.find((s) => s.propertyId === def.key)
            const first = sortOptions[0].key
            const second = sortOptions[1]?.key ?? first
            const option = at?.option === first ? second : first
            done({ ...state, sorts: [{ propertyId: def.key, option, structureId: typeId }, ...state.sorts.filter((s) => s.propertyId !== def.key)] })
          }}
        >
          Sort
        </Item>
      )}
      {canFilter && (
        <Item
          icon="ph-funnel-simple"
          onClick={() => done({ ...state, filterGroup: { ...state.filterGroup, elements: [...state.filterGroup.elements, newFilter(choice)] } })}
        >
          Filter
        </Item>
      )}
      {kinds.length > 0 && (
        <Item icon="ph-sigma" onClick={() => setCalc(true)} trailing={<Icon name="ph-caret-right" size={14} />}>
          Calculate
        </Item>
      )}
      {!isTitle && (
        <Item
          icon="ph-eye-slash"
          onClick={() => {
            onConfig(setHidden(config, def.key, true))
            onClose()
          }}
        >
          Hide
        </Item>
      )}
      <Item
        icon="ph-text-align-left"
        onClick={() => {
          onConfig(setWrap(config, def.key, !wrapped))
          onClose()
        }}
      >
        {wrapped ? 'Unwrap Text' : 'Wrap Text'}
      </Item>
      {col && (
        <Item
          icon="ph-push-pin"
          onClick={() => {
            onConfig(setPinnedThrough(config, isPinHere ? null : def.key))
            onClose()
          }}
        >
          {/* The shipped string, typo kept. */}
          {isPinHere ? 'Unpin cClumns' : 'Pin Columns'}
        </Item>
      )}
      {onEditProperty && (
        <Item
          icon="ph-pencil-simple"
          onClick={() => {
            onClose()
            onEditProperty()
          }}
        >
          Edit Property
        </Item>
      )}
    </div>
  )
}
