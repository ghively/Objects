// The legend: a swatch and a name per series (or per slice of a donut).
export interface LegendItem {
  id: string
  label: string
  color: string
}

export function Legend({ items }: { items: LegendItem[] }) {
  if (items.length === 0) return null
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pt-2 text-[12px] text-fg-muted" data-testid="chart-legend">
      {items.map((it) => (
        <li key={it.id} className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: it.color }} />
          <span className="max-w-[16rem] truncate">{it.label}</span>
        </li>
      ))}
    </ul>
  )
}
