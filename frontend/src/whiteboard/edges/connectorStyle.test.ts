import { Position } from '@xyflow/react'
import { describe, expect, test } from 'vitest'
import { COLOR_VALUES } from '../colors'
import { edge } from '../test/boards'
import {
  DEFAULT_EDGE_COLOR,
  EDGE_STROKE_WIDTH,
  SELECTED_EDGE_COLOR,
  edgeColor,
  labelText,
  markerIds,
  pathFor,
  strokeFor,
} from './connectorStyle'

const g = { sourceX: 0, sourceY: 0, targetX: 200, targetY: 100, sourcePosition: Position.Right, targetPosition: Position.Left }

describe('connectorStyle', () => {
  test('unset connection renders cornered and unset line solid', () => {
    expect(pathFor(undefined, g)).toEqual(pathFor('cornered', g))
    const s = strokeFor(edge())
    expect(s.strokeDasharray).toBeUndefined()
    expect(s.strokeLinecap).toBe('round')
    expect(s.strokeWidth).toBe(EDGE_STROKE_WIDTH)
  })

  test('straight, cornered and curved paths', () => {
    const straight = pathFor('straight', g).path
    const cornered = pathFor('cornered', g).path
    const curved = pathFor('curved', g).path
    expect(straight).toMatch(/^M ?0[ ,]0 ?L ?200[ ,]100$/)
    expect(curved).toContain('C')
    expect(cornered).not.toContain('C')
    expect(cornered).toContain('Q') // smoothstep's rounded corners
    expect(new Set([straight, cornered, curved]).size).toBe(3)
    // the label sits at the midpoint
    const mid = pathFor('straight', g)
    expect([mid.labelX, mid.labelY]).toEqual([100, 50])
  })

  test('dash arrays', () => {
    expect(strokeFor(edge({ line: 'dashed' })).strokeDasharray).toBe('8 8')
    expect(strokeFor(edge({ line: 'dotted' })).strokeDasharray).toBe('0 10')
    expect(strokeFor(edge({ line: 'dotted' })).strokeLinecap).toBe('round')
    expect(strokeFor(edge({ line: 'solid' })).strokeDasharray).toBeUndefined()
  })

  test('markers none, arrow, dot, double at start and end; arrowClosed renders as arrow', () => {
    expect(markerIds(edge())).toEqual({})
    expect(markerIds(edge({ markerStart: 'none', markerEnd: 'none' }))).toEqual({})
    expect(markerIds(edge({ markerEnd: 'arrow' }))).toEqual({ end: 'wb-tip-arrow-default' })
    expect(markerIds(edge({ markerStart: 'dot', markerEnd: 'double' }))).toEqual({
      start: 'wb-tip-dot-default',
      end: 'wb-tip-double-default',
    })
    expect(markerIds(edge({ markerEnd: 'arrowClosed' }))).toEqual(markerIds(edge({ markerEnd: 'arrow' })))
  })

  test('edge colour applies to stroke and markers', () => {
    expect(strokeFor(edge({ color: 'blue' }), { dark: true }).stroke).toBe(COLOR_VALUES.blue.borderDark)
    expect(strokeFor(edge({ color: 'blue' }), { dark: false }).stroke).toBe(COLOR_VALUES.blue.borderLight)
    expect(strokeFor(edge()).stroke).toBe(DEFAULT_EDGE_COLOR)
    expect(edgeColor(edge({ color: 'blue' }), true)).toBe(SELECTED_EDGE_COLOR)
    expect(markerIds(edge({ color: 'red', markerEnd: 'arrow' }))).toEqual({ end: 'wb-tip-arrow-red' })
    expect(markerIds(edge({ color: 'red', markerEnd: 'arrow' }), true)).toEqual({ end: 'wb-tip-arrow-selected' })
  })

  test('label text comes from the block, else the deprecated label', () => {
    expect(labelText(edge({ label: 'old' }), undefined)).toBe('old')
    expect(labelText(edge({ label: 'old' }), { type: 'text', markdown: 'new' })).toBe('new')
    expect(labelText(edge(), undefined)).toBeNull()
  })
})
