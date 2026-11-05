// Shared SVG pieces: clickable marks, the value grid with its tick labels, the category labels.
import type { KeyboardEvent } from 'react'
import type { ChartData } from './chartData'
import { shortNumber, truncate, type Scale } from './scale'

/** A bar, point or slice the user picked: its category and (for a split chart) its series. */
export interface ChartHit {
  category: number
  series: number | null
}

export interface ChartDrawProps {
  data: ChartData
  width: number
  height: number
  showValues: boolean
  selected: ChartHit | null
  onSelect(hit: ChartHit): void
}

export const TEXT_STYLE = { fill: 'var(--color-fg-muted)', fontSize: 11 } as const
export const GRID_STYLE = { stroke: 'var(--color-line)', strokeWidth: 1 } as const
export const VALUE_STYLE = { fill: 'var(--color-fg)', fontSize: 11 } as const
/** About how wide one character of an 11 px label is (for fitting labels; our estimate). */
export const CHAR_W = 6.4

export const sameHit = (a: ChartHit | null, b: ChartHit) => !!a && a.category === b.category && a.series === b.series

export interface MarkProps {
  role: 'button'
  tabIndex: number
  'aria-label': string
  'aria-pressed': boolean
  className: string
  opacity: number
  onClick(): void
  onKeyDown(e: KeyboardEvent<SVGElement>): void
}

/** The props that make a shape a button: click or Enter/Space selects it; others dim while one is selected. */
export function markProps(hit: ChartHit, label: string, p: Pick<ChartDrawProps, 'selected' | 'onSelect'>): MarkProps {
  const on = sameHit(p.selected, hit)
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    'aria-pressed': on,
    className: 'cursor-pointer outline-none focus-visible:opacity-80',
    opacity: p.selected && !on ? 0.4 : 1,
    onClick: () => p.onSelect(hit),
    onKeyDown: (e: KeyboardEvent<SVGElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        p.onSelect(hit)
      }
    },
  }
}

/** The accessible name of a mark: "March 2026: 12" or "March 2026 · Done: 4". */
export function markLabel(data: ChartData, category: number, series: number | null, value: number): string {
  const c = data.categories[category]
  const s = series !== null && data.split ? ` · ${data.series[series].label}` : ''
  return `${c.label}${s}: ${data.format(value)}`
}

/** The width the value ticks need. */
export function tickWidth(scale: Scale, percent: boolean): number {
  const longest = Math.max(...scale.ticks.map((t) => (shortNumber(t) + (percent ? '%' : '')).length))
  return Math.ceil(longest * CHAR_W) + 10
}

/** Grid lines and tick labels along the value axis (horizontal lines, or vertical ones for `across`). */
export function ValueGrid({
  scale,
  pos,
  from,
  to,
  across,
  percent,
}: {
  scale: Scale
  /** The value's pixel position. */
  pos(v: number): number
  /** The plot's extent on the other axis. */
  from: number
  to: number
  /** Values run across (horizontal bars): vertical lines, labels below. */
  across?: boolean
  percent: boolean
}) {
  return (
    <g data-chart-axis="value">
      {scale.ticks.map((t) => {
        const p = pos(t)
        const label = shortNumber(t) + (percent ? '%' : '')
        return across ? (
          <g key={t}>
            <line x1={p} x2={p} y1={from} y2={to} style={GRID_STYLE} opacity={t === 0 ? 1 : 0.6} />
            <text x={p} y={to + 14} textAnchor="middle" style={TEXT_STYLE}>
              {label}
            </text>
          </g>
        ) : (
          <g key={t}>
            <line x1={from} x2={to} y1={p} y2={p} style={GRID_STYLE} opacity={t === 0 ? 1 : 0.6} />
            <text x={from - 6} y={p} dy="0.32em" textAnchor="end" style={TEXT_STYLE}>
              {label}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/** Every k-th category label so that labels about `minGap` px apart don't collide. */
export function labelStep(count: number, extent: number, minGap: number): number {
  if (count <= 0 || extent <= 0) return 1
  return Math.max(1, Math.ceil((count * minGap) / extent))
}

/** The category labels under a vertical chart, thinned and cut to their room. */
export function CategoryLabels({ data, center, y, room }: { data: ChartData; center(i: number): number; y: number; room: number }) {
  const step = labelStep(data.categories.length, room * data.categories.length, 56)
  const chars = Math.floor((room * step) / CHAR_W)
  return (
    <g data-chart-axis="category">
      {data.categories.map((c, i) =>
        i % step === 0 ? (
          <text key={c.id} x={center(i)} y={y} textAnchor="middle" style={TEXT_STYLE}>
            <title>{c.label}</title>
            {truncate(c.label, chars)}
          </text>
        ) : null,
      )}
    </g>
  )
}
