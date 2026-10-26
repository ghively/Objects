// Helpers shared by the card layouts: container width and the grouped sections.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Group } from '../group'
import type { LayoutProps } from '../DataView'

/** The width of the element `ref` points at, kept current with a ResizeObserver. */
export function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (ref.current) setWidth(ref.current.clientWidth)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** Each group under its header (when the view is grouped); a closed group renders only its header. */
export function Sections({ props, children }: { props: LayoutProps; children(group: Group): ReactNode }) {
  const { groups, grouped, header, closed, groupCount } = props
  return (
    <div className="flex flex-col gap-2">
      {groups.map((g) => (
        <div key={g.id} className="flex flex-col gap-1">
          {grouped && header(g, groupCount(g))}
          {!(grouped && closed(g)) && children(g)}
        </div>
      ))}
    </div>
  )
}
