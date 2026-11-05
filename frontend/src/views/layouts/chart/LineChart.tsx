// One line per series over the categories, a point per value (the points are the clickable marks).
// A point without rows (an empty date bucket filled in between) is no tab stop; past
// `SPARSE_POINTS` categories it draws no point at all (our choice), so a long run of empty
// buckets stays light. The line still runs through it.
import { CategoryLabels, VALUE_STYLE, ValueGrid, markLabel, markProps, tickWidth, type ChartDrawProps } from './marks'
import { niceScale } from './scale'

/** Past this many categories, points without rows are not drawn (our choice). */
export const SPARSE_POINTS = 60

export function LineChart(props: ChartDrawProps) {
  const { data, width, height, showValues } = props
  const scale = niceScale(data.categories.flatMap((c) => c.values), 5, data.integer)
  const top = showValues ? 18 : 10
  const bottom = 24
  const left = tickWidth(scale, data.percent) + 6
  const right = 8
  const plotW = Math.max(1, width - left - right)
  const plotH = Math.max(1, height - top - bottom)
  const n = Math.max(1, data.categories.length)
  const band = plotW / n
  const y = (v: number) => top + (plotH * (scale.max - v)) / (scale.max - scale.min)
  const cx = (i: number) => left + band * (i + 0.5)
  const sparse = data.categories.length > SPARSE_POINTS
  return (
    <svg width={width} height={height} role="group" aria-label={data.yLabel} data-chart-kind="line">
      <ValueGrid scale={scale} pos={y} from={left} to={left + plotW} percent={data.percent} />
      {data.series.map((s, si) => {
        const d = data.categories.map((c, i) => `${i === 0 ? 'M' : 'L'}${cx(i).toFixed(1)},${y(c.values[si]).toFixed(1)}`).join(' ')
        return (
          <g key={s.id}>
            <path d={d} style={{ fill: 'none', stroke: s.color, strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }} />
            {data.categories.map((c, i) => {
              const hit = { category: i, series: data.split ? si : null }
              const v = c.values[si]
              const empty = (c.seriesRows[si]?.length ?? 0) === 0
              if (empty && sparse) return null
              const name = markLabel(data, i, hit.series, v)
              const mark = markProps(hit, name, props)
              return (
                <g key={c.id}>
                  <circle cx={cx(i)} cy={y(v)} r={4} style={{ fill: s.color, stroke: 'var(--color-app)', strokeWidth: 1.5 }} {...mark} tabIndex={empty ? -1 : mark.tabIndex}>
                    <title>{name}</title>
                  </circle>
                  {showValues && (
                    <text x={cx(i)} y={y(v) - 8} textAnchor="middle" style={VALUE_STYLE} data-chart-value>
                      {data.format(v)}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        )
      })}
      <CategoryLabels data={data} center={cx} y={top + plotH + 16} room={band} />
    </svg>
  )
}
