// A donut: one slice per category (its first value; zero and negative values get no slice), the
// total in the middle.
import { TEXT_STYLE, markLabel, markProps, type ChartDrawProps } from './marks'

const TAU = Math.PI * 2

/** The path of a ring slice from angle `a0` to `a1` (radians, 0 at 12 o'clock, clockwise). */
export function slicePath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  // A whole ring is drawn as two halves (an arc can't start and end at the same point).
  if (a1 - a0 >= TAU - 1e-6) {
    const mid = a0 + Math.PI
    return `${slicePath(cx, cy, r0, r1, a0, mid)} ${slicePath(cx, cy, r0, r1, mid, a0 + TAU)}`
  }
  const pt = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)},${(cy - r * Math.cos(a)).toFixed(2)}`
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M${pt(r1, a0)} A${r1},${r1} 0 ${large} 1 ${pt(r1, a1)} L${pt(r0, a1)} A${r0},${r0} 0 ${large} 0 ${pt(r0, a0)} Z`
}

export function DonutChart(props: ChartDrawProps) {
  const { data, width, height, showValues } = props
  const cx = width / 2
  const cy = height / 2
  const r1 = Math.max(10, Math.min(width, height) / 2 - 8)
  const r0 = r1 * 0.6
  const values = data.categories.map((c) => Math.max(0, c.values[0] ?? 0))
  const total = values.reduce((a, b) => a + b, 0)
  let at = 0
  return (
    <svg width={width} height={height} role="group" aria-label={data.yLabel} data-chart-kind="donut">
      {total <= 0 && <path d={slicePath(cx, cy, r0, r1, 0, TAU)} style={{ fill: 'var(--color-line)' }} />}
      {total > 0 &&
        data.categories.map((c, i) => {
          const v = values[i]
          if (v <= 0) return null
          const a0 = at
          const a1 = at + (v / total) * TAU
          at = a1
          const name = markLabel(data, i, null, c.values[0])
          const mid = (a0 + a1) / 2
          const rm = (r0 + r1) / 2
          return (
            <g key={c.id}>
              <path d={slicePath(cx, cy, r0, r1, a0, a1)} style={{ fill: c.color, stroke: 'var(--color-app)', strokeWidth: 1 }} {...markProps({ category: i, series: null }, name, props)}>
                <title>{name}</title>
              </path>
              {showValues && a1 - a0 > 0.3 && (
                <text x={cx + rm * Math.sin(mid)} y={cy - rm * Math.cos(mid)} dy="0.32em" textAnchor="middle" style={{ fill: 'var(--color-fg)', fontSize: 11 }} data-chart-value>
                  {data.format(c.values[0])}
                </text>
              )}
            </g>
          )
        })}
      <text x={cx} y={cy - 4} textAnchor="middle" style={{ fill: 'var(--color-fg)', fontSize: 20, fontWeight: 600 }} data-chart-total>
        {data.format(total)}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" style={TEXT_STYLE}>
        {data.yLabel}
      </text>
    </svg>
  )
}
