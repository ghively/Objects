// colour-literals: content palette
// How graph nodes and edges look. Sizes, the reduced-node styling and the tag colouring are our
// values; colours come
// from M2's theme palette.
import type { GraphNode, TypeDef } from '@/api/types'
import { themeColor, type ThemeColor } from '@/theme/palette'

export const NODE_MIN_SIZE = 3
export const NODE_MAX_SIZE = 18

/** Radius in px: `3 + 2·sqrt(degree)`, capped at 18. */
export function nodeSize(degree: number): number {
  return Math.min(NODE_MAX_SIZE, NODE_MIN_SIZE + 2 * Math.sqrt(Math.max(0, degree)))
}

/** A reduced node (an object a filter left in only to carry links)
 *  is drawn de-emphasised: at the smallest size, in gray, unlabelled until hovered. This styling is our own
 *  choice. */
export const REDUCED_NODE_SIZE = NODE_MIN_SIZE
export const REDUCED_NODE_COLOR: ThemeColor = 'gray'

/** A node's theme colour: its type's colour; a tag in its own tag colour when it has one. */
export function nodeColor(
  node: Pick<GraphNode, 'type' | 'tag'>,
  typesById: Record<string, Pick<TypeDef, 'color'> | undefined>,
  tagColor?: string | null,
): ThemeColor {
  if (node.tag && tagColor) return themeColor(tagColor)
  return themeColor(typesById[node.type]?.color)
}

/** The theme colours' line values (`--line-<c>` in tokens.css), for when CSS can't be read. */
const FALLBACK: Record<ThemeColor, string> = {
  gray: '#71717a',
  rose: '#f43f5e',
  pink: '#ec4899',
  fuchsia: '#d946ef',
  purple: '#a855f7',
  violet: '#8b5cf6',
  indigo: '#6366f1',
  blue: '#3b82f6',
  sky: '#0ea5e9',
  cyan: '#06b6d4',
  teal: '#14b8a6',
  emerald: '#10b981',
  green: '#22c55e',
  lime: '#84cc16',
  yellow: '#eab308',
  amber: '#f59e0b',
  orange: '#f97316',
  red: '#ef4444',
}

function cssVar(name: string): string {
  if (typeof document === 'undefined') return ''
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  } catch {
    return ''
  }
}

/** A concrete colour string for WebGL (sigma can't use `var(--…)`). */
export function colorValue(c: ThemeColor): string {
  return cssVar(`--line-${c}`) || FALLBACK[c]
}

/** The label ink and the dimmed colour of nodes outside a hover. */
export function canvasColors(): { label: string; dim: string; edge: string; hoverBg: string } {
  return {
    label: cssVar('--text') || '#f4f4f5',
    dim: cssVar('--border-subtle') || '#27272a',
    edge: '#52525b',
    // The hovered node's label box: the theme's raised surface, so the label (drawn in `label`)
    // reads in every theme. sigma's own hover box is always white (white on white in dark themes).
    hoverBg: cssVar('--bg-raised') || cssVar('--bg-panel') || '#27272a',
  }
}

interface HoverData {
  x: number
  y: number
  size: number
  label?: string | null
}

interface HoverSettings {
  labelSize: number
  labelFont: string
  labelWeight: string
}

/** sigma's `defaultDrawNodeHover`, with the box in `bg` and the label in `color` instead of
 *  sigma's fixed white box (audit 2026-11-10: the hovered name was unreadable in dark themes). */
export function drawNodeHover(
  context: CanvasRenderingContext2D,
  data: HoverData,
  settings: HoverSettings,
  bg: string,
  color: string,
): void {
  const size = settings.labelSize
  context.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`
  context.fillStyle = bg
  context.shadowOffsetX = 0
  context.shadowOffsetY = 0
  context.shadowBlur = 8
  context.shadowColor = '#000'
  const PADDING = 2
  if (typeof data.label === 'string' && data.label) {
    const textWidth = context.measureText(data.label).width
    const boxWidth = Math.round(textWidth + 5)
    const boxHeight = Math.round(size + 2 * PADDING)
    const radius = Math.max(data.size, size / 2) + PADDING
    const angle = Math.asin(boxHeight / 2 / radius)
    const dx = Math.sqrt(Math.abs(radius ** 2 - (boxHeight / 2) ** 2))
    context.beginPath()
    context.moveTo(data.x + dx, data.y + boxHeight / 2)
    context.lineTo(data.x + radius + boxWidth, data.y + boxHeight / 2)
    context.lineTo(data.x + radius + boxWidth, data.y - boxHeight / 2)
    context.lineTo(data.x + dx, data.y - boxHeight / 2)
    context.arc(data.x, data.y, radius, angle, -angle)
    context.closePath()
    context.fill()
  } else {
    context.beginPath()
    context.arc(data.x, data.y, data.size + PADDING, 0, Math.PI * 2)
    context.closePath()
    context.fill()
  }
  context.shadowBlur = 0
  if (typeof data.label === 'string' && data.label) {
    context.fillStyle = color
    context.fillText(data.label, data.x + data.size + 3, data.y + size / 3)
  }
}

export type EdgeKind = 'link' | 'tag'

export interface EdgeStyle {
  color: string
  size: number
}

export function edgeStyle(kind: EdgeKind): EdgeStyle {
  switch (kind) {
    case 'tag':
      return { color: 'rgba(154, 154, 160, 0.4)', size: 0.8 }
    default:
      return { color: 'rgba(154, 154, 160, 0.45)', size: 1 }
  }
}
