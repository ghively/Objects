import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo, TypeDef } from '@/api/types'
import { objectDetail, objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/find/FindBar', () => ({ FindBar: () => null }))
vi.mock('@/references/ReferencesSection', () => ({ ReferencesSection: () => null }))

import { api } from '@/api/client'
import { resetAiStore, useAi } from '@/ai/store'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { OBJECT_AI_TEXT, ObjectView } from './ObjectView'

const mocked = vi.mocked(api)
const PAGE: TypeDef = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', revision: 'r1' })
const PATH = 'Pages/Notes.md'

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  resetAiStore()
  useSettings.setState({ settings: settingsDefaults })
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  const detail = objectDetail({
    summary: objectSummary({ path: PATH, type: 'page', title: 'Notes' }),
    frontmatter: { type: 'Page', title: 'Notes' },
    body: 'Hello.\n',
    version: 'v1',
  })
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
  mocked.objects.mockResolvedValue([detail.summary])
  mocked.object.mockResolvedValue(detail)
  mocked.resolve.mockResolvedValue(null)
  mocked.onChange.mockReturnValue(() => undefined)
})
afterEach(() => {
  useSettings.setState({ settings: settingsDefaults })
  resetAiStore()
})

async function openMenu(user: ReturnType<typeof userEvent.setup>, mode: 'page' | 'peek' = 'page') {
  render(<ObjectView path={PATH} mode={mode} />)
  await screen.findByText('Hello.')
  await user.click(screen.getByRole('button', { name: 'More' }))
  return screen.findByRole('menu')
}

const names = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((i) => i.textContent ?? '')

describe('ObjectView AI entries (M10)', () => {
  test('the … menu offers the two AI rows after "Add to whiteboard"', async () => {
    const user = userEvent.setup()
    const menu = await openMenu(user)
    const list = names(menu)
    const at = list.indexOf('Add to whiteboard')
    expect(list.slice(at, at + 3)).toEqual(['Add to whiteboard', 'Add tags using AI', 'Fill empty properties using AI'])
  })

  test.each([
    ['Add tags using AI', 'tagObject'],
    ['Fill empty properties using AI', 'autofill'],
  ] as const)('%s opens the AI chat with the object as context', async (row, mode) => {
    const user = userEvent.setup()
    const menu = await openMenu(user)
    await user.click(within(menu).getByRole('menuitem', { name: row }))
    expect(useAi.getState().pending?.seed).toEqual({ mode, contextPaths: [PATH] })
  })

  test('the peek header has the AI sparkle (the page has the focus button instead)', async () => {
    const user = userEvent.setup()
    const view = render(<ObjectView path={PATH} mode="peek" />)
    await screen.findByText('Hello.')
    expect(screen.queryByRole('button', { name: 'Enter focus mode' })).toBeNull()
    await user.click(screen.getByRole('button', { name: OBJECT_AI_TEXT.peek }))
    expect(useAi.getState().pending?.seed).toEqual({ mode: 'chat', contextPaths: [PATH] })
    view.unmount()

    render(<ObjectView path={PATH} mode="page" />)
    await screen.findByText('Hello.')
    expect(screen.getByRole('button', { name: 'Enter focus mode' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: OBJECT_AI_TEXT.peek })).toBeNull()
  })

  test('no AI entries while AI features are hidden', async () => {
    useSettings.setState({ settings: { ...settingsDefaults, aiHidden: true } })
    const user = userEvent.setup()
    const menu = await openMenu(user, 'peek')
    expect(names(menu).filter((n) => n.includes('AI'))).toEqual([])
    expect(screen.queryByRole('button', { name: OBJECT_AI_TEXT.peek })).toBeNull()
  })
})
