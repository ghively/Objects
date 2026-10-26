// `embed`: a stack of embed cards, each showing the object's body.
import { EmbedCard } from '../cards/EmbedCard'
import type { LayoutProps } from '../DataView'
import { Sections } from './shared'

export function EmbedLayout(props: LayoutProps) {
  return (
    <Sections props={props}>
      {(g) => (
        <div className="flex flex-col gap-3">
          {g.rows.map((r) => (
            <EmbedCard key={r.summary.path} row={r} type={props.typesById[r.summary.type]} onOpen={props.onOpen} />
          ))}
        </div>
      )}
    </Sections>
  )
}
