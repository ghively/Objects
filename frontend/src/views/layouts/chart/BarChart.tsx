// Bars, vertical or horizontal; a split chart stacks its series (positive values up, negative down).
import { CategoryLabels, CHAR_W, TEXT_STYLE, VALUE_STYLE, ValueGrid, markLabel, markProps, tickWidth, type ChartDrawProps } from './marks'
import type { ChartData } from './chartData'
import { niceScale, truncate } from './scale'

interface Segment {
  series: number
  value: number
  /** Value-space extent of the segment. */
  from: number
  to: number
}

/** Each category's segments, stacked from 0 (positives up, negatives down). */
function stacks(data: ChartData): { segments: Segment[]; hi: number; lo: number }[] {
  return data.categories.map((c) => {
    let up = 0
    let down = 0
    const segments: Segment[] = []
    c.values.forEach((value, series) => {
      if (value === 0) return
      if (value > 0) {
        segments.push({ series, value, from: up, to: up + value })
        up += value
      } else {
        segments.push({ series, value, from: down + value, to: down })
        down += value
      }
    })
    return { segments, hi: up, lo: down }
  })
}

const colorOf = (data: ChartData, category: number, series: number) =>
  data.split ? data.series[series].color : data.colorByCategory ? data.categories[category].color : data.series[0].color

/** Pixel height per horizontal bar row (our choice); the chart grows to fit. */
export const ROW_H = 26

export function BarChart(props: ChartDrawProps & { horizontal?: boolean }) {
  return props.horizontal ? <HorizontalBars {...props} /> : <VerticalBars {...props} />
}

function VerticalBars(props: ChartDrawProps) {
  const { data, width, height, showValues } = props
  const st = stacks(data)
  const scale = niceScale(st.flatMap((s) => [s.hi, s.lo]), 5, data.integer)
  const top = showValues ? 18 : 10
  const bottom = 24
  const left = tickWidth(scale, data.percent) + 6
  const right = 8
  const plotW = Math.max(1, width - left - right)
  const plotH = Math.max(1, height - top - bottom)
  const n = Math.max(1, data.categories.length)
  const band = plotW / n
  const barW = Math.max(2, Math.min(56, band * 0.7))
  const y = (v: number) => top + (plotH * (scale.max - v)) / (scale.max - scale.min)
  const cx = (i: number) => left + band * (i + 0.5)
  const label = (i: number, s: (typeof st)[number]) => {
    const single = !data.split
    if (!showValues || (!single && !data.additive)) return null
    const value = single ? data.categories[i].values[0] : s.hi + s.lo
    const at = value >= 0 ? y(s.hi) - 4 : y(s.lo) + 12
    return (
      <text x={cx(i)} y={at} textAnchor="middle" style={VALUE_STYLE} data-chart-value>
        {data.format(value)}
      </text>
    )
  }
  return (
    <svg width={width} height={height} role="group" aria-label={data.yLabel} data-chart-kind="bar">
      <ValueGrid scale={scale} pos={y} from={left} to={left + plotW} percent={data.percent} />
      {st.map((s, i) => (
        <g key={data.categories[i].id}>
          {s.segments.map((seg) => {
            const hit = { category: i, series: data.split ? seg.series : null }
            const name = markLabel(data, i, hit.series, seg.value)
            return (
              <rect
                key={seg.series}
                x={cx(i) - barW / 2}
                width={barW}
                y={y(seg.to)}
                height={Math.max(1, y(seg.from) - y(seg.to))}
                rx={2}
                style={{ fill: colorOf(data, i, seg.series) }}
                {...markProps(hit, name, props)}
              >
                <title>{name}</title>
              </rect>
            )
          })}
          {label(i, s)}
        </g>
      ))}
      <CategoryLabels data={data} center={cx} y={top + plotH + 16} room={band} />
    </svg>
  )
}

function HorizontalBars(props: ChartDrawProps) {
  const { data, width, showValues } = props
  const st = stacks(data)
  const scale = niceScale(st.flatMap((s) => [s.hi, s.lo]), 5, data.integer)
  const n = Math.max(1, data.categories.length)
  const top = 6
  const bottom = 22
  const height = Math.max(props.height, n * ROW_H + top + bottom)
  const longest = Math.max(0, ...data.categories.map((c) => c.label.length))
  const left = Math.max(48, Math.min(Math.ceil(longest * CHAR_W) + 12, 180, width * 0.35))
  const right = showValues ? 48 : 16
  const plotW = Math.max(1, width - left - right)
  const plotH = n * ROW_H
  const x = (v: number) => left + (plotW * (v - scale.min)) / (scale.max - scale.min)
  const cy = (i: number) => top + ROW_H * (i + 0.5)
  const barH = ROW_H * 0.68
  const chars = Math.floor((left - 10) / CHAR_W)
  return (
    <svg width={width} height={height} role="group" aria-label={data.yLabel} data-chart-kind="horizontalBar">
      <ValueGrid scale={scale} pos={x} from={top} to={top + plotH} across percent={data.percent} />
      {st.map((s, i) => {
        const c = data.categories[i]
        const total = data.split ? s.hi + s.lo : c.values[0]
        return (
          <g key={c.id}>
            <text x={left - 8} y={cy(i)} dy="0.32em" textAnchor="end" style={TEXT_STYLE}>
              <title>{c.label}</title>
              {truncate(c.label, chars)}
            </text>
            {s.segments.map((seg) => {
              const hit = { category: i, series: data.split ? seg.series : null }
              const name = markLabel(data, i, hit.series, seg.value)
              return (
                <rect
                  key={seg.series}
                  y={cy(i) - barH / 2}
                  height={barH}
                  x={x(seg.from)}
                  width={Math.max(1, x(seg.to) - x(seg.from))}
                  rx={2}
                  style={{ fill: colorOf(data, i, seg.series) }}
                  {...markProps(hit, name, props)}
                >
                  <title>{name}</title>
                </rect>
              )
            })}
            {showValues && (!data.split || data.additive) && (
              <text x={x(total >= 0 ? s.hi : s.lo) + (total >= 0 ? 4 : -4)} y={cy(i)} dy="0.32em" textAnchor={total >= 0 ? 'start' : 'end'} style={VALUE_STYLE} data-chart-value>
                {data.format(total)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
