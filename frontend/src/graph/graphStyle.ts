// colour-literals: content palette
// How graph nodes and edges look. Sizes, the reduced-node styling and the tag colouring are our
// values (the reference has no node size formula, colours or reduced-node drawing); colours come
// from M2's theme palette.
import type { GraphNode, TypeDef } from '@/api/types'
import { themeColor, type ThemeColor } from '@/theme/palette'

export const NODE_MIN_SIZE = 3
export const NODE_MAX_SIZE = 18

/** Radius in px: `3 + 2·sqrt(degree)`, capped at 18. */
export function nodeSize(degree: number): number {
  return Math.min(NODE_MAX_SIZE, NODE_MIN_SIZE + 2 * Math.sqrt(Math.max(0, degree)))
}

/** A reduced node (an object a filter left in only to carry links, Capacities' `isReducedNode`)
 *  is drawn de-emphasised: at the smallest size, in gray, unlabelled until hovered. Our choice:
 *  the reference does not show how Capacities draws them. */
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
  gray: '#5c5959',
  rose: '#ea4561',
  pink: '#e34d97',
  fuchsia: '#d14be5',
  purple: '#a558ee',
  violet: '#8a5fed',
  indigo: '#6568e8',
  blue: '#3f80eb',
  sky: '#199dd9',
  cyan: '#11a9c3',
  teal: '#1dad9d',
  emerald: '#19ae7d',
  green: '#2bbb60',
  lime: '#7fbe1f',
  yellow: '#daaa14',
  amber: '#e89a17',
  orange: '#ec731f',
  red: '#e54a4a',
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
export function canvasColors(): { label: string; dim: string; edge: string } {
  return {
    label: cssVar('--text') || '#f4f4f5',
    dim: cssVar('--border-subtle') || '#2d2c31',
    edge: '#4a494f',
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
