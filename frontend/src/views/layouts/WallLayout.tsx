// `wall`: masonry, N flex columns with the cards dealt round-robin by index.
import type { Row } from '@/api/types'
import type { LayoutProps } from '../DataView'
import { columnCount } from '../model'
import { CardItem } from './CardItem'
import { Sections, useWidth } from './shared'

export function WallLayout(props: LayoutProps) {
  const [ref, width] = useWidth()
  const n = columnCount(width)
  return (
    <div ref={ref} data-testid="wall-layout">
      <Sections props={props}>
        {(g) => {
          const cols: Row[][] = Array.from({ length: n }, () => [])
          g.rows.forEach((r, i) => cols[i % n].push(r))
          return (
            <div className="flex gap-3" data-testid="wall">
              {cols.map((rows, i) => (
                <div key={i} data-testid="wall-column" className="flex min-w-0 flex-1 flex-col gap-y-3">
                  {rows.map((r) => (
                    <CardItem key={r.summary.path} layout={props} row={r} variant="wall" />
                  ))}
                </div>
              ))}
            </div>
          )
        }}
      </Sections>
    </div>
  )
}
