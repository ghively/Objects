// `gallery`: one horizontally scrolling strip of fixed-width cards. Only dashboard sections use it;
// no layout picker offers it.
import type { LayoutProps } from '../DataView'
import { CARD_WIDTH } from '../model'
import { CardItem } from './CardItem'

export function GalleryLayout(props: LayoutProps) {
  const rows = props.groups.flatMap((g) => g.rows)
  return (
    <div data-testid="gallery" className="flex gap-3 overflow-x-auto pb-2">
      {rows.map((r) => (
        <div
          key={r.summary.path}
          data-testid="gallery-item"
          className="w-[168px] shrink-0 sm:w-[208px]"
          data-width={`${CARD_WIDTH.phone}/${CARD_WIDTH.desktop}`}
        >
          <CardItem layout={props} row={r} className="h-full" />
        </div>
      ))}
    </div>
  )
}
