import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import type { ObjectSummary, TypeDef } from '@/api/types'
import { useLinkIndex } from '@/links/linkIndex'
import type { WhiteboardHost } from '../host'
import { ObjectPicker } from './ObjectPicker'

beforeAll(() => {
  // jsdom lacks scrollIntoView, which cmdk calls on the selected item.
  Element.prototype.scrollIntoView ??= function () {}
})

afterEach(() => {
  useLinkIndex.setState({ types: [], objects: [], loaded: false })
})

function summary(path: string, title: string, type = 'page'): ObjectSummary {
  return {
    path,
    id: null,
    type,
    title,
    icon: null,
    iconColor: null,
    description: null,
    aliases: [],
    createdAt: null,
    lastUpdated: null,
    tags: [],
    template: null,
  } as unknown as ObjectSummary
}

function type(id: string, name: string, pluralName: string): TypeDef {
  return { id, name, pluralName, icon: null } as unknown as TypeDef
}

function host(over: Partial<WhiteboardHost> = {}): WhiteboardHost {
  return {
    openObject: vi.fn(),
    linkFor: vi.fn((p: string) => `[[${p}]]`),
    resolve: vi.fn(async () => null),
    rows: vi.fn(async () => []),
    requestDelete: vi.fn(),
    createObject: vi.fn(async () => 'People/New.md'),
    objects: vi.fn(async () => [
      summary('Devices/Router A.md', 'Router A'),
      summary('Devices/Switch B.md', 'Switch B'),
      summary('Devices/Router C.md', 'Router C'),
    ]),
    ...over,
  }
}

test('test object picker filters titles and picks; new object creates then picks', async () => {
  const user = userEvent.setup()
  const onPick = vi.fn()
  const h = host()
  const { unmount } = render(<ObjectPicker mode="link" host={h} onPick={onPick} onClose={vi.fn()} />)
  const input = screen.getByPlaceholderText('Search notes')
  await waitFor(() => expect(screen.getByText('Switch B')).toBeInTheDocument())
  await user.type(input, 'router')
  expect(screen.queryByText('Switch B')).toBeNull()
  expect(screen.getByText('Router A')).toBeInTheDocument()
  expect(screen.getByText('Router C')).toBeInTheDocument()
  await user.click(screen.getByText('Router C'))
  expect(onPick).toHaveBeenCalledWith({ path: 'Devices/Router C.md' })
  // Enter picks the highlighted (first) row.
  await user.clear(input)
  await user.type(input, 'switch{Enter}')
  expect(onPick).toHaveBeenLastCalledWith({ path: 'Devices/Switch B.md' })
  unmount()

  useLinkIndex.setState({ types: [type('person', 'Person', 'People'), type('page', 'Page', 'Pages')] })
  const onPick2 = vi.fn()
  render(<ObjectPicker mode="create" host={h} onPick={onPick2} onClose={vi.fn()} />)
  expect(screen.getByPlaceholderText('Pick a type')).toBeInTheDocument()
  expect(h.objects).toHaveBeenCalledTimes(1) // not fetched for "New object"
  await user.click(screen.getByText('Person'))
  expect(h.createObject).toHaveBeenCalledWith('person')
  await waitFor(() => expect(onPick2).toHaveBeenCalledWith({ path: 'People/New.md' }))
})

test('escape closes the picker', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  render(<ObjectPicker mode="link" host={host()} onPick={vi.fn()} onClose={onClose} />)
  await user.type(screen.getByPlaceholderText('Search notes'), '{Escape}')
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('a failed create shows the error and picks nothing', async () => {
  const user = userEvent.setup()
  useLinkIndex.setState({ types: [type('person', 'Person', 'People')] })
  const onPick = vi.fn()
  render(
    <ObjectPicker
      mode="create"
      host={host({ createObject: vi.fn(async () => Promise.reject(new Error('nope'))) })}
      onPick={onPick}
      onClose={vi.fn()}
    />,
  )
  await user.click(screen.getByText('Person'))
  expect(await screen.findByRole('alert')).toHaveTextContent('nope')
  expect(onPick).not.toHaveBeenCalled()
})
