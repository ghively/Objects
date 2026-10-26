// The wide card: a horizontal card with the image on the left.
import type { MouseEvent } from 'react'
import { api } from '@/api/client'
import type { Row, TypeDef } from '@/api/types'
import { cn } from '@/lib/utils'
import { CARD_BASE, CardProperties, cardImage } from './SmallCard'
import type { CardProperty } from './cardConfig'

export function WideCard({
  row,
  type,
  props,
  hide,
  onOpen,
}: {
  row: Row
  type?: TypeDef
  props: CardProperty[]
  hide?: string[]
  onOpen?(row: Row, e: MouseEvent): void
}) {
  const image = cardImage(row)
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="wide-card"
      data-path={row.summary.path}
      onClick={(e) => onOpen?.(row, e)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen?.(row, e as unknown as MouseEvent)
      }}
      className={cn(CARD_BASE, 'w-full flex-row')}
    >
      {image && <img src={api.fileUrl(image)} alt="" className="h-auto w-40 shrink-0 object-cover" />}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        <CardProperties row={row} type={type} props={props} hide={hide} />
      </div>
    </div>
  )
}
