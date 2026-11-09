// The legend: a swatch and a name per series (or per slice of a donut). The `data-chart-legend*`
// attributes are how "Export SVG" (`exportChart`) reads the swatch colours and labels back.
export interface LegendItem {
  id: string
  label: string
  color: string
}

export function Legend({ items }: { items: LegendItem[] }) {
  if (items.length === 0) return null
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pt-2 text-[12px] text-fg-muted" data-testid="chart-legend" data-chart-legend>
      {items.map((it) => (
        <li key={it.id} className="flex min-w-0 items-center gap-1.5" data-chart-legend-item>
          <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: it.color }} data-chart-swatch />
          <span className="max-w-[16rem] truncate" data-chart-legend-label>
            {it.label}
          </span>
        </li>
      ))}
    </ul>
  )
}
