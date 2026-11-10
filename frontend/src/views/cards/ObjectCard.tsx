// One object in one of its link views (M31: the fifth, "page"). The layouts use it; object blocks in M7.
import type { MouseEvent } from 'react'
import type { Row, TypeDef } from '@/api/types'
import type { CardProperty } from './cardConfig'
import { EmbedCard } from './EmbedCard'
import { InlineToken } from './InlineToken'
import { PageCard } from './PageCard'
import { SmallCard } from './SmallCard'
import { WideCard } from './WideCard'

export type CardView = 'inline' | 'smallCard' | 'wideCard' | 'embed' | 'page'

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
    case 'page':
      return <PageCard row={row} type={type} onOpen={onOpen} />
    default:
      return <SmallCard row={row} type={type} props={props} hide={hide} onOpen={onOpen} />
  }
}
