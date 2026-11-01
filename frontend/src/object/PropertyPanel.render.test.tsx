// Audit 2026-11-01 (minor, front end): one value change re-rendered all 40 cells of the panel.
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { objectSummary, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

// Every cell counts its renders by key.
const renders = new Map<string, number>()
vi.mock('@/properties/cellFor', async (orig) => {
  const real = await orig<typeof import('@/properties/cellFor')>()
  const Counting = ({ def, value }: { def: { key: string }; value?: unknown }) => {
    renders.set(def.key, (renders.get(def.key) ?? 0) + 1)
    return <span>{String(value ?? '')}</span>
  }
  return { ...real, cellForDef: () => Counting }
})

import { resetLinkIndex } from '@/links/linkIndex'
import { PropertyPanel } from './PropertyPanel'

const DEFS = Array.from({ length: 40 }, (_, i) =>
  propertyDef({ id: `p${i}`, key: `k${i}`, name: `Prop ${i}`, type: i % 2 ? 'text' : 'label', options: i % 2 ? {} : { set: [] } }),
)
const TYPE = typeDef({ id: 'project', name: 'Project', propertyDefinitions: DEFS })
const summary = objectSummary({ path: 'Projects/X.md', type: 'project' })
const fm = (k1: string) =>
  Object.fromEntries(DEFS.map((d, i) => [d.key, i === 1 ? k1 : i % 2 ? `v${i}` : [`L${i}`]])) as Record<string, unknown>

beforeEach(() => {
  resetLinkIndex()
  renders.clear()
})

describe('PropertyPanel render counts', () => {
  test('one value change re-renders only its own cell, even with new handlers from the parent', () => {
    const { rerender } = render(
      <PropertyPanel type={TYPE} frontmatter={fm('a')} summary={summary} onChange={() => undefined} onTypeChange={async () => null} onOpenTag={() => undefined} />,
    )
    expect(renders.size).toBe(40)
    renders.clear()
    // The parent rebuilds the frontmatter (every list value a new array) and passes new handlers.
    rerender(
      <PropertyPanel type={TYPE} frontmatter={fm('b')} summary={{ ...summary }} onChange={() => undefined} onTypeChange={async () => null} onOpenTag={() => undefined} />,
    )
    expect([...renders.keys()]).toEqual(['k1'])
  })

  test('a date cell, which reads sibling keys, re-renders when another key changes', () => {
    const DATE = propertyDef({ id: 'p-due', key: 'due', name: 'Due', type: 'datetime' })
    const NOTE = propertyDef({ id: 'p-note', key: 'note', name: 'Note', type: 'text' })
    const T = typeDef({ id: 'project', name: 'Project', propertyDefinitions: [DATE, NOTE] })
    const { rerender } = render(<PropertyPanel type={T} frontmatter={{ due: '2026-11-01', note: 'a' }} onChange={() => undefined} />)
    renders.clear()
    rerender(<PropertyPanel type={T} frontmatter={{ due: '2026-11-01', note: 'a', repeat: 'FREQ=DAILY' }} onChange={() => undefined} />)
    expect([...renders.keys()]).toEqual(['due'])
  })
})
