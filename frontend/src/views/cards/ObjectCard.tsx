// One object in one of its four link views. The layouts use it now; object blocks in M7.
import type { MouseEvent } from 'react'
import type { Row, TypeDef } from '@/api/types'
import type { CardProperty } from './cardConfig'
import { EmbedCard } from './EmbedCard'
import { InlineToken } from './InlineToken'
import { SmallCard } from './SmallCard'
import { WideCard } from './WideCard'

export type CardView = 'inline' | 'smallCard' | 'wideCard' | 'embed'

export function ObjectCard({
  row,
  type,
  view,
  props,
  hide,
  onOpen,
}: {
  row: Row
  type?: TypeDef
  view: CardView
  props: CardProperty[]
  hide?: string[]
  onOpen?(row: Row, e: MouseEvent): void
}) {
  switch (view) {
    case 'inline':
      return (
        <button type="button" onClick={(e) => onOpen?.(row, e)} className="inline-flex max-w-full rounded-md px-1 hover:bg-hover">
          <InlineToken row={row} type={type} />
        </button>
      )
    case 'wideCard':
      return <WideCard row={row} type={type} props={props} hide={hide} onOpen={onOpen} />
    case 'embed':
      return <EmbedCard row={row} type={type} onOpen={onOpen} />
    default:
      return <SmallCard row={row} type={type} props={props} hide={hide} onOpen={onOpen} />
  }
}
