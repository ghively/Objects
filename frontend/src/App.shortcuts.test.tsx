import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo } from '@/api/types'
import { objectDetail, objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import App from './App'

const mocked = vi.mocked(api)

const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true, revision: 'r1' })
const PROJECT = typeDef({ id: 'project', name: 'Project', pluralName: 'Projects', revision: 'r1' })
const PATH = 'Projects/Notes.md'
const NOTES = objectSummary({ path: PATH, type: 'project', title: 'Notes' })

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE, PROJECT] } satisfies SpaceInfo)
  mocked.objects.mockResolvedValue([NOTES])
  mocked.object.mockImplementation(async () =>
    objectDetail({ summary: NOTES, frontmatter: { type: 'Project', title: 'Notes' }, body: 'Some text.\n', version: 'v1' }),
  )
})

function ctrl(el: Element | Document, key: string): boolean {
  return fireEvent.keyDown(el, { key, ctrlKey: true })
}

async function openObjectPage() {
  useTabs.getState().open({ kind: 'object', path: PATH })
  const utils = render(<App />)
  await screen.findByRole('textbox', { name: 'Title' })
  await waitFor(() => expect(utils.container.querySelector('.ProseMirror')).not.toBeNull())
  return utils
}

describe('app shortcuts', () => {
  test('test Ctrl+N creates object of current type', async () => {
    useTabs.getState().open({ kind: 'type', typeId: 'project' })
    render(<App />)
    await screen.findByRole('heading', { name: 'Projects' })
    const notPrevented = ctrl(document.body, 'n')
    expect(notPrevented).toBe(false) // preventDefault: the native window must not open a new window
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('project', {}))
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'project/Untitled.md' }))
  })

  test('Ctrl+N with no type open creates a Page', async () => {
    render(<App />)
    await waitFor(() => expect(mocked.space).toHaveBeenCalled())
    ctrl(document.body, 'n')
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('page', {}))
  })

  test('Ctrl+U opens the New menu', async () => {
    render(<App />)
    await waitFor(() => expect(mocked.space).toHaveBeenCalled())
    ctrl(document.body, 'u')
    expect(await screen.findByRole('textbox', { name: 'Search Object Types' })).toBeInTheDocument()
  })

  test('test Ctrl+Backspace in the title input and in the editor does not open the delete dialog', async () => {
    const { container } = await openObjectPage()
    const title = screen.getByRole('textbox', { name: 'Title' })
    expect(ctrl(title, 'Backspace')).toBe(true) // not prevented: it stays "delete previous word"
    const editor = container.querySelector('.ProseMirror')!
    ctrl(editor, 'Backspace')
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  test('test Ctrl+Backspace outside editable elements opens the delete dialog, and cancel deletes nothing', async () => {
    const user = userEvent.setup()
    await openObjectPage()
    expect(ctrl(document.body, 'Backspace')).toBe(false)
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Delete this object?')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocked.deleteObject).not.toHaveBeenCalled()
  })
})
