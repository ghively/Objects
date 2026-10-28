// A row as a card in a layout: the type's card properties, with the view's override applied.
import type { Row } from '@/api/types'
import type { LayoutProps } from '../DataView'
import { cardProperties } from '../cards/cardConfig'
import { SmallCard } from '../cards/SmallCard'
import { cn } from '@/lib/utils'

export function CardItem({ layout, row, hide, className }: { layout: LayoutProps; row: Row; hide?: string[]; className?: string }) {
  const type = layout.typesById[row.summary.type]
  const props = type
    ? cardProperties(type, layout.state.viewDefinition)
    : [{ propertyType: 'entity_title', propertyId: 'title' }]
  const extras = layout.rowExtras?.(row)
  const selected = layout.isSelected?.(row.summary.path) ?? false
  const card = (
    <SmallCard
      row={row}
      type={type}
      props={props}
      hide={hide}
      onOpen={layout.onOpen}
      className={cn(className, selected && 'bg-[var(--block-selection-bg)]')}
      leading={extras?.leading}
      trailing={extras?.trailing}
    />
  )
  // M9: a selected card ("Select multiple") is marked by a box-less wrapper, so the grid is unchanged.
  return selected ? (
    <div data-selected="" className="contents">
      {card}
    </div>
  ) : (
    card
  )
}
