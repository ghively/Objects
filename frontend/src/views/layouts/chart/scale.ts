// Axis helpers: a value domain with round ticks, and short tick labels.

export interface Scale {
  min: number
  max: number
  ticks: number[]
}

/** A round step near `span / count`: 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const f = raw / mag
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * mag
}

const clean = (n: number) => Number(n.toPrecision(12))

/**
 * A domain that holds 0 and every value, widened to round ticks (about `count` of them). All
 * zeros (or nothing) give 0–1. A count axis never gets fractional ticks.
 */
export function niceScale(values: number[], count = 5, integer = false): Scale {
  let lo = Math.min(0, ...values.filter(Number.isFinite))
  let hi = Math.max(0, ...values.filter(Number.isFinite))
  if (lo === hi) hi = lo + 1
  let step = niceStep(hi - lo, count)
  if (integer) step = Math.max(1, Math.ceil(step))
  lo = clean(Math.floor(lo / step) * step)
  hi = clean(Math.ceil(hi / step) * step)
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v = clean(v + step)) ticks.push(v)
  return { min: lo, max: hi, ticks }
}

/** A short tick label: 1.2K, 3M, 0.25 (our choice of suffixes). */
export function shortNumber(n: number): string {
  const abs = Math.abs(n)
  const fix = (x: number) => String(clean(Math.round(x * 100) / 100))
  if (abs >= 1e9) return `${fix(n / 1e9)}B`
  if (abs >= 1e6) return `${fix(n / 1e6)}M`
  if (abs >= 1e4) return `${fix(n / 1e3)}K`
  return fix(n)
}

/** A label cut to `max` characters with an ellipsis. */
export function truncate(text: string, max: number): string {
  if (max < 2) return text ? '…' : ''
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
