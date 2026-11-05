import { describe, expect, test } from 'vitest'
import type { Row } from '@/api/types'
import { objectSummary, row } from '@/test/mockApi'
import { buildRowTree, flattenTree, parentPath, visibleTreeRows } from './subItems'

const mk = (name: string, parent?: string | null): Row =>
  row({ summary: objectSummary({ path: `S/${name}.md`, title: name }), links: parent === undefined ? {} : { parent: [parent ? `S/${parent}.md` : null] } })
const order = (rows: Row[]) =>
  flattenTree(buildRowTree(rows, 'parent')).map((t) => `${'-'.repeat(t.depth)}${t.row.summary.title}${t.hasChildren ? '+' : ''}`)

describe('sub-item nesting', () => {
  test('children follow their parent in input order; an absent parent leaves a row at the top', () => {
    const rows = [mk('B1', 'A'), mk('A'), mk('C', 'Missing'), mk('B2', 'A'), mk('D', 'B2')]
    expect(order(rows)).toEqual(['A+', '-B1', '-B2+', '--D', 'C'])
  })

  test('cycles are broken by showing their rows at the top; a row hanging off a cycle nests', () => {
    const rows = [mk('X', 'Y'), mk('Y', 'X'), mk('Z', 'X'), mk('Self', 'Self')]
    expect(order(rows)).toEqual(['X+', '-Z', 'Y', 'Self'])
    const ring = [mk('P', 'R'), mk('Q', 'P'), mk('R', 'Q')]
    expect(order(ring)).toEqual(['P', 'Q', 'R'])
  })

  test('every row once, whatever the links', () => {
    const rows = Array.from({ length: 60 }, (_, i) => mk(`N${i}`, `N${(i * 7 + 3) % 61}`))
    const out = flattenTree(buildRowTree(rows, 'parent')).map((t) => t.row.summary.path)
    expect(out.sort()).toEqual(rows.map((r) => r.summary.path).sort())
    // Duplicated input rows are kept once.
    expect(flattenTree(buildRowTree([...rows, rows[0]], 'parent'))).toHaveLength(60)
  })

  test('a closed parent hides its whole subtree', () => {
    const tree = flattenTree(buildRowTree([mk('A'), mk('B', 'A'), mk('C', 'B'), mk('D')], 'parent'))
    expect(visibleTreeRows(tree, new Set(['S/A.md'])).map((t) => t.row.summary.title)).toEqual(['A', 'D'])
    expect(visibleTreeRows(tree, new Set(['S/B.md'])).map((t) => t.row.summary.title)).toEqual(['A', 'B', 'D'])
  })

  test('the parent is the first resolved link', () => {
    expect(parentPath(row({ links: { parent: [null, 'S/A.md'] } }), 'parent')).toBe('S/A.md')
    expect(parentPath(row({}), 'parent')).toBeNull()
  })
})
