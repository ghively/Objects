// Perf audit scratch: the search palette typing with 5,000 summaries and 50 types.
import { writeFileSync } from 'node:fs'
import { Profiler } from 'react'
import { act, fireEvent, render } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { objectSummary, typeDef } from '@/test/mockApi'
vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
import { useLinkIndex } from '@/links/linkIndex'
import { SearchView } from '@/palette/SearchView'
import { buildSearchOptions, NO_FILTERS } from '@/palette/searchOptions'

const TYPES = Array.from({ length: 50 }, (_, i) => typeDef({ id: i === 0 ? 'page' : `type${i}`, name: i === 0 ? 'Page' : `Project ${i}`, pluralName: i === 0 ? 'Pages' : `Project ${i}s` }))
const OBJECTS = Array.from({ length: 5000 }, (_, i) => objectSummary({ path: `P/Object ${i}.md`, type: TYPES[i % 50].id, title: `Object ${i}`, id: `id${i}`, tags: [`tag ${i % 500}`, `project ${i % 300}`] }))
const results: string[] = []
const ms = (x: number) => Math.round(x * 10) / 10
const log = (w: string, v: number | string) => results.push(`${w}: ${typeof v === 'number' ? ms(v) : v}`)

test('perf: palette typing', async () => {
  useLinkIndex.setState({ types: TYPES, objects: OBJECTS, loaded: true, revision: 1 })
  const tags = Array.from({ length: 800 }, (_, i) => `tag ${i}`)
  let best = Infinity
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now()
    buildSearchOptions('project 12 notes', TYPES, tags, NO_FILTERS)
    best = Math.min(best, performance.now() - t0)
  }
  log('buildSearchOptions(50 types, 800 tags) best-of-5 ms', best)
  let dur = 0
  const r = render(
    <Profiler id="p" onRender={(_i, _p, a) => (dur += a)}>
      <SearchView onDone={() => {}} />
    </Profiler>,
  )
  const input = r.container.querySelector('input') ?? r.getByRole('combobox')
  log('mount profiler ms', dur)
  const word = 'project 12'
  let typed = ''
  const per: number[] = []
  for (const ch of word) {
    typed += ch
    dur = 0
    const t0 = performance.now()
    act(() => { fireEvent.change(input, { target: { value: typed } }) })
    per.push(performance.now() - t0)
  }
  log('keystroke wall ms per char', per.map(ms).join(', '))
  log('keystroke wall ms max', Math.max(...per))
  writeFileSync('/tmp/claude-0/-home-user-Objects/925c9253-6d40-5f27-a712-45dc1ac4b9ca/scratchpad/perf-palette.txt', results.join('\n'))
  expect(true).toBe(true)
}, 60_000)
