import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ObjectDetail, ObjectSummary, SpaceInfo, TypeDef } from '@/api/types'
import { objectDetail, objectSummary, propertyDef, typeDef as makeType } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { ObjectPeek } from './ObjectPeek'

const mocked = vi.mocked(api)

function typeDef(id: string, name: string, pluralName: string, color: string): TypeDef {
  return makeType({
    id,
    name,
    pluralName,
    folder: pluralName,
    icon: { type: 'iconify', val: 'ph-file-text' },
    color,
    propertyDefinitions: [propertyDef({ id: 'p1', key: 'email', name: 'Email', type: 'text' })],
  })
}

const TYPES = [typeDef('person', 'Person', 'People', 'orange'), typeDef('page', 'Page', 'Pages', 'pink')]

function summary(path: string, title: string, type = 'page'): ObjectSummary {
  return objectSummary({ path, type, title })
}

const OBJECTS = [
  summary('Pages/One.md', 'One'),
  summary('Pages/Two.md', 'Two'),
  summary('Pages/Three.md', 'Three'),
  summary('Pages/Four.md', 'Four'),
  summary('Pages/Five.md', 'Five'),
  summary('People/Ada Lovelace.md', 'Ada Lovelace', 'person'),
]
const LIST = OBJECTS.slice(0, 5).map((o) => o.path)

function detail(path: string): ObjectDetail {
  const s = OBJECTS.find((o) => o.path === path)!
  return objectDetail({
    summary: { ...s, tags: ['infra'] },
    frontmatter: { type: s.type, title: s.title, tags: ['infra'] },
    body: `\nSee [[Ada Lovelace]] and [[Nobody Here]].\n`,
    version: `v-${path}`,
  })
}

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: TYPES } satisfies SpaceInfo)
  mocked.objects.mockResolvedValue(OBJECTS)
  mocked.object.mockImplementation(async (path: string) => detail(path))
  mocked.resolve.mockImplementation(async (link: string) =>
    link === 'Ada Lovelace' ? 'People/Ada Lovelace.md' : null,
  )
})

async function openPeekAt(index: number) {
  usePeek.getState().peek(LIST[index], LIST)
  render(<ObjectPeek />)
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByRole('heading', { level: 1, name: OBJECTS[index].title })
  return dialog
}

async function chip(dialog: HTMLElement, target: string): Promise<HTMLElement> {
  return waitFor(() => {
    const el = dialog.querySelector(`[data-wikilink][data-target="${target}"]`) as HTMLElement | null
    if (!el) throw new Error(`no chip for ${target}`)
    return el
  })
}

describe('ObjectPeek', () => {
  test('peek pager steps through list and shows "2 / 5"', async () => {
    const dialog = await openPeekAt(1)
    expect(within(dialog).getByText('2 / 5')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }))
    await within(dialog).findByRole('heading', { level: 1, name: 'Three' })
    expect(within(dialog).getByText('3 / 5')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Previous' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Previous' }))
    await within(dialog).findByRole('heading', { level: 1, name: 'One' })
    expect(within(dialog).getByText('1 / 5')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Previous' })).toBeDisabled()
  })

  test('shows the property panel with muted Empty values', async () => {
    const dialog = await openPeekAt(0)
    const panel = within(dialog).getByRole('complementary', { name: 'Properties' })
    expect(within(panel).getByText('Email')).toBeInTheDocument()
    expect(within(panel).getByPlaceholderText('Empty')).toBeInTheDocument()
  })

  test('unresolved wikilink renders dimmed', async () => {
    const dialog = await openPeekAt(0)
    const missing = await chip(dialog, 'Nobody Here')
    await waitFor(() => expect(missing).toHaveAttribute('data-unresolved'))
    expect(missing).toHaveClass('wikilink-unresolved')

    const ada = await chip(dialog, 'Ada Lovelace')
    await waitFor(() => expect(ada).toHaveAttribute('data-resolved-path', 'People/Ada Lovelace.md'))
    expect(ada).not.toHaveAttribute('data-unresolved')
    expect(ada.dataset.color).toBe('orange')
    expect(ada.title).toBe('Ada Lovelace')
  })

  test('link click opens peek; ctrl+click opens new tab', async () => {
    const dialog = await openPeekAt(0)
    const ada = await chip(dialog, 'Ada Lovelace')
    await waitFor(() => expect(ada).toHaveAttribute('data-resolved-path'))

    fireEvent.click(ada, { ctrlKey: true })
    expect(useTabs.getState().tabs).toHaveLength(1)
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'People/Ada Lovelace.md' })
    expect(usePeek.getState().path).toBe('Pages/One.md')

    fireEvent.click(ada)
    expect(usePeek.getState().path).toBe('People/Ada Lovelace.md')
    expect(usePeek.getState().list).toEqual(['People/Ada Lovelace.md'])

    // Clicking an unresolved link does nothing.
    const before = usePeek.getState().path
    const missing = await chip(screen.getByRole('dialog'), 'Nobody Here').catch(() => null)
    if (missing) fireEvent.click(missing)
    expect(usePeek.getState().path).toBe(before)
  })
})
