// Polish item 17: the property-pane toggle (top left of the content column, in the page and the
// peek) hides the pane for that object and remembers it in the object's `hideProperties` key
// (`hideProperties` in the frontmatter).
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo, TypeDef } from '@/api/types'
import { objectDetail, objectSummary, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/find/FindBar', () => ({ FindBar: () => null }))
vi.mock('@/references/ReferencesSection', () => ({ ReferencesSection: () => null }))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { settingsDefaults } from '@/settings/defaults'
import { useSettings } from '@/settings/useSettings'
import { ObjectView } from './ObjectView'

const mocked = vi.mocked(api)
const PAGE: TypeDef = typeDef({
  id: 'page',
  name: 'Page',
  pluralName: 'Pages',
  revision: 'r1',
  propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }), propertyDef({ id: 'status', type: 'text', name: 'Status' })],
})
const PATH = 'Pages/Notes.md'

function load(frontmatter: Record<string, unknown>) {
  const detail = objectDetail({
    summary: objectSummary({ path: PATH, type: 'page', title: 'Notes' }),
    frontmatter: { type: 'Page', title: 'Notes', ...frontmatter },
    body: 'Hello.\n',
    version: 'v1',
  })
  mocked.objects.mockResolvedValue([detail.summary])
  mocked.object.mockResolvedValue(detail)
}

beforeEach(() => {
  localStorage.clear()
  useSettings.setState({ settings: { ...settingsDefaults }, loaded: true })
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
  mocked.resolve.mockResolvedValue(null)
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.updateProperties.mockImplementation(async (_p, updates) => ({
    version: 'v2',
    frontmatter: { type: 'Page', title: 'Notes', ...updates },
    links: {},
  }) as never)
})

describe('property-pane toggle (polish item 17)', () => {
  test('an object saved with hideProperties opens with the pane hidden', async () => {
    load({ hideProperties: true })
    render(<ObjectView path={PATH} mode="peek" />)
    await screen.findByText('Hello.')
    expect(screen.getByRole('button', { name: 'Show properties' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('Status')).toBeNull()
  })

  test('toggling saves hideProperties on the object, and showing again removes it', async () => {
    const user = userEvent.setup()
    load({})
    render(<ObjectView path={PATH} mode="peek" />)
    await screen.findByText('Hello.')
    expect(screen.getByText('Status')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hide properties' }))
    expect(screen.queryByText('Status')).toBeNull()
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith(PATH, { hideProperties: true }, 'v1', undefined))
    await user.click(screen.getByRole('button', { name: 'Show properties' }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenLastCalledWith(PATH, { hideProperties: null }, expect.anything(), undefined))
    expect(screen.getByText('Status')).toBeInTheDocument()
  })
})

// 2026-11-09 (Gene): "Show properties by default" off opens notes with the panel hidden.
describe('Show properties by default: off', () => {
  beforeEach(() => {
    useSettings.setState({ settings: { ...settingsDefaults, showPropertiesByDefault: false }, loaded: true })
  })

  test('an object opens with the pane hidden', async () => {
    load({})
    render(<ObjectView path={PATH} mode="peek" />)
    await screen.findByText('Hello.')
    expect(screen.getByRole('button', { name: 'Show properties' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('Status')).toBeNull()
  })

  test('showing saves hideProperties: false on that object; hiding again removes it', async () => {
    const user = userEvent.setup()
    load({})
    render(<ObjectView path={PATH} mode="peek" />)
    await screen.findByText('Hello.')
    await user.click(screen.getByRole('button', { name: 'Show properties' }))
    expect(screen.getByText('Status')).toBeInTheDocument()
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith(PATH, { hideProperties: false }, 'v1', undefined))
    await user.click(screen.getByRole('button', { name: 'Hide properties' }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenLastCalledWith(PATH, { hideProperties: null }, expect.anything(), undefined))
    expect(screen.queryByText('Status')).toBeNull()
  })

  test('an object saved with hideProperties: false still opens with the pane shown', async () => {
    load({ hideProperties: false })
    render(<ObjectView path={PATH} mode="peek" />)
    await screen.findByText('Hello.')
    expect(screen.getByText('Status')).toBeInTheDocument()
  })
})

// M32, item 11: a type with no properties of its own (the built-in Note and Daily note: system
// rows only) opens with the pane closed; the note's own toggle and the device setting still decide.
describe('a type with no properties of its own (M32)', () => {
  const sys = (id: string, type: 'entity_title' | 'entity_tags' | 'entity_createdAt', name: string) => propertyDef({ id, key: id, type, name })
  const SYSTEM = [sys('title', 'entity_title', 'Title'), sys('tags', 'entity_tags', 'Tags'), sys('createdAt', 'entity_createdAt', 'Created at')]
  const NOTE: TypeDef = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true, revision: 'r1', propertyDefinitions: SYSTEM })
  const DAILY: TypeDef = typeDef({
    id: 'dailynote',
    name: 'DailyNote',
    pluralName: 'DailyNotes',
    basic: true,
    revision: 'r1',
    propertyDefinitions: [
      ...SYSTEM,
      propertyDef({ id: 'date', key: 'date', type: 'datetime', name: 'Date' }),
      propertyDef({ id: 'reviewed', key: 'reviewed', type: 'boolean', name: 'Reviewed' }),
    ],
  })

  function loadOf(type: TypeDef, frontmatter: Record<string, unknown> = {}) {
    const path = type === DAILY ? 'DailyNotes/2026-11-11.md' : PATH
    const detail = objectDetail({
      summary: objectSummary({ path, type: type.id, title: 'Notes' }),
      frontmatter: { type: type.name, title: 'Notes', ...frontmatter },
      body: 'Hello.\n',
      version: 'v1',
    })
    mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [type] } satisfies SpaceInfo)
    mocked.objects.mockResolvedValue([detail.summary])
    mocked.object.mockResolvedValue(detail)
    return path
  }
  const closed = () => expect(screen.getByRole('button', { name: 'Show properties' })).toHaveAttribute('aria-pressed', 'false')
  const open = () => expect(screen.getByRole('button', { name: 'Hide properties' })).toHaveAttribute('aria-pressed', 'true')

  test.each(['page', 'peek'] as const)('a Note opens with the pane closed (%s)', async (mode) => {
    loadOf(NOTE)
    render(<ObjectView path={PATH} mode={mode} />)
    await screen.findByText('Hello.')
    // Once the type is known too: still closed.
    await waitFor(() => expect(mocked.space).toHaveBeenCalled())
    closed()
    expect(screen.queryByText('Created at')).toBeNull()
    expect(mocked.updateProperties).not.toHaveBeenCalled()
  })

  test('a Daily note (its Date and Reviewed show in its header) opens with the pane closed', async () => {
    const path = loadOf(DAILY)
    render(<ObjectView path={path} mode="page" />)
    await screen.findByText('Hello.')
    closed()
  })

  test("the note's own toggle wins: showing saves hideProperties: false, hiding again removes it", async () => {
    const user = userEvent.setup()
    loadOf(NOTE)
    render(<ObjectView path={PATH} mode="page" />)
    await screen.findByText('Hello.')
    await user.click(screen.getByRole('button', { name: 'Show properties' }))
    expect(await screen.findByText('Created at')).toBeInTheDocument()
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith(PATH, { hideProperties: false }, 'v1', undefined))
    await user.click(screen.getByRole('button', { name: 'Hide properties' }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenLastCalledWith(PATH, { hideProperties: null }, expect.anything(), undefined))
    closed()
  })

  test('a Note saved with hideProperties: false opens with the pane shown', async () => {
    loadOf(NOTE, { hideProperties: false })
    render(<ObjectView path={PATH} mode="page" />)
    await screen.findByText('Hello.')
    open()
    expect(await screen.findByText('Created at')).toBeInTheDocument()
  })

  test('a type with a property of its own still opens with the pane shown, and "Show properties by default" off closes it', async () => {
    load({})
    const first = render(<ObjectView path={PATH} mode="page" />)
    await screen.findByText('Hello.')
    expect(await screen.findByText('Status')).toBeInTheDocument()
    open()
    first.unmount()
    useSettings.setState({ settings: { ...settingsDefaults, showPropertiesByDefault: false }, loaded: true })
    render(<ObjectView path={PATH} mode="page" />)
    await screen.findByText('Hello.')
    closed()
  })

  test('"Show properties by default" off keeps a Note closed, and its toggle still opens it', async () => {
    const user = userEvent.setup()
    useSettings.setState({ settings: { ...settingsDefaults, showPropertiesByDefault: false }, loaded: true })
    loadOf(NOTE)
    render(<ObjectView path={PATH} mode="page" />)
    await screen.findByText('Hello.')
    closed()
    await user.click(screen.getByRole('button', { name: 'Show properties' }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith(PATH, { hideProperties: false }, 'v1', undefined))
    open()
  })
})
