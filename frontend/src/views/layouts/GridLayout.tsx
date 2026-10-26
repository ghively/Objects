// `grid`: small cards in as many columns as fit.
import type { LayoutProps } from '../DataView'
import { columnCount } from '../model'
import { CardItem } from './CardItem'
import { Sections, useWidth } from './shared'

export function GridLayout(props: LayoutProps) {
  const [ref, width] = useWidth()
  const n = columnCount(width)
  return (
    <div ref={ref} data-testid="grid-layout">
      <Sections props={props}>
        {(g) => (
          <div
            data-testid="grid"
            data-columns={n}
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
          >
            {g.rows.map((r) => (
              <CardItem key={r.summary.path} layout={props} row={r} />
            ))}
          </div>
        )}
      </Sections>
    </div>
  )
}
