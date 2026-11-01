/**
 * Audit 2026-11-01: the inline (daily note) view tested its body for emptiness by serialising
 * the whole body on every input and key-up. It reads the editor's DOM first; a body is
 * serialised only when it holds nothing but textless paragraphs.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, ObjectDetail, SpaceInfo } from '@/api/types'
import { objectDetail, objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('./document', async (orig) => {
  const m = await orig<typeof import('./document')>()
  return { ...m, serializeBody: vi.fn(m.serializeBody) }
})

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { ObjectView } from '@/object/ObjectView'
import { serializeBody } from './document'

const mocked = vi.mocked(api)
const PATH = 'DailyNotes/2026-11-01.md'

function detail(body: string): ObjectDetail {
  return objectDetail({
    summary: objectSummary({ path: PATH, type: 'page', title: '2026-11-01' }),
    frontmatter: { type: 'page', title: '2026-11-01' },
    body,
    version: 'v1',
  })
}

beforeEach(() => {
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.space.mockResolvedValue({
    name: 's',
    root: '/s',
    types: [typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', folder: 'Pages' })],
  } satisfies SpaceInfo)
  mocked.objects.mockResolvedValue([])
  mocked.resolve.mockResolvedValue(null)
  mocked.onChange.mockImplementation((_cb: (e: ChangeEvent) => void) => () => {})
})

async function mount(body: string) {
  mocked.object.mockResolvedValue(detail(body))
  const utils = render(<ObjectView path={PATH} mode="inline" placeholder="Start your daily note" />)
  const pm = await waitFor(() => {
    const el = utils.container.querySelector('.ProseMirror') as HTMLElement | null
    expect(el).toBeTruthy()
    return el!
  })
  return pm
}

/** Key-ups and inputs as typing fires them; returns how many serialisations they caused. */
function keystrokes(pm: HTMLElement, n = 5): number {
  const spy = vi.mocked(serializeBody)
  spy.mockClear()
  for (let i = 0; i < n; i++) {
    fireEvent.input(pm)
    fireEvent.keyUp(pm, { key: 'ArrowDown' })
  }
  return spy.mock.calls.length
}

describe('inline view emptiness', () => {
  test('a body with text is not serialised per keystroke', async () => {
    const pm = await mount('Some text.\n\nMore.\n')
    expect(keystrokes(pm)).toBe(0)
    expect(screen.queryByTestId('inline-placeholder')).toBeNull()
  })

  test('a textless body with a block (a divider) is not serialised per keystroke either', async () => {
    const pm = await mount('---\n')
    expect(keystrokes(pm)).toBe(0)
    expect(screen.queryByTestId('inline-placeholder')).toBeNull()
  })

  test('an empty body shows the placeholder', async () => {
    const pm = await mount('')
    keystrokes(pm, 1)
    expect(screen.getByTestId('inline-placeholder')).toHaveTextContent('Start your daily note')
  })
})
