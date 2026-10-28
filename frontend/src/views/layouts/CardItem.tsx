// A row as a card in a layout: the type's card properties, with the view's override applied.
import type { Row } from '@/api/types'
import type { LayoutProps } from '../DataView'
import { cardProperties } from '../cards/cardConfig'
import { SmallCard } from '../cards/SmallCard'

export function CardItem({ layout, row, hide, className }: { layout: LayoutProps; row: Row; hide?: string[]; className?: string }) {
  const type = layout.typesById[row.summary.type]
  const props = type
    ? cardProperties(type, layout.state.viewDefinition)
    : [{ propertyType: 'entity_title', propertyId: 'title' }]
  const extras = layout.rowExtras?.(row)
  return (
    <SmallCard
      row={row}
      type={type}
      props={props}
      hide={hide}
      onOpen={layout.onOpen}
      className={className}
      leading={extras?.leading}
      trailing={extras?.trailing}
    />
  )
}
