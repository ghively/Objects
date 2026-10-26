import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ObjectSummary } from '@/api/types'
import { objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { currentTarget, useTabs } from '@/nav/tabs'
import { ObjectHeader } from './ObjectHeader'

const mocked = vi.mocked(api)
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages' })
const TAG = typeDef({ id: 'tag', name: 'Tag', pluralName: 'Tags' })
const DAILY = typeDef({ id: 'dailynote', name: 'DailyNote', pluralName: 'DailyNotes' })

function page(partial: Partial<ObjectSummary> = {}): ObjectSummary {
  return objectSummary({ path: 'Pages/Notes.md', type: 'page', title: 'Notes', ...partial })
}

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.ensureTag.mockImplementation(async (name: string) => ({ path: `Tags/${name}.md`, created: false }))
  mocked.images.mockResolvedValue([])
  useLinkIndex.setState({
    types: [PAGE, TAG, DAILY],
    objects: [
      objectSummary({ path: 'Tags/Docs.md', type: 'tag', title: 'Docs', color: 'bg-red' }),
      objectSummary({ path: 'Tags/Design.md', type: 'tag', title: 'Design', color: 'bg-blue' }),
    ],
    loaded: true,
  })
})

describe('ObjectHeader', () => {
  test('test #do opens tag picker and adds tag, removing "#do" from title', async () => {
    const onRename = vi.fn()
    const onPropertiesChange = vi.fn()
    render(<ObjectHeader summary={page()} type={PAGE} onRename={onRename} onPropertiesChange={onPropertiesChange} />)
    const title = screen.getByRole('textbox', { name: 'Title' })
    title.focus()
    fireEvent.change(title, { target: { value: 'Notes #do', selectionStart: 9 } })

    const list = await screen.findByRole('listbox', { name: 'Tags' })
    // The picker starts searching for the query.
    expect(screen.getByPlaceholderText('Search for tags or create one')).toHaveValue('do')
    fireEvent.click(within(list).getByRole('option', { name: /Docs/ }))

    expect(onPropertiesChange).toHaveBeenCalledWith({ tags: ['Docs'] })
    expect(title).toHaveValue('Notes')
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Tags' })).not.toBeInTheDocument())
    fireEvent.blur(title)
    // The title is unchanged after the cut, so nothing is renamed.
    expect(onRename).not.toHaveBeenCalled()
  })

  test('test Add icon and Add description write icon and description', async () => {
    const user = userEvent.setup()
    const onPropertiesChange = vi.fn()
    render(<ObjectHeader summary={page()} type={PAGE} onRename={vi.fn()} onPropertiesChange={onPropertiesChange} />)

    await user.click(screen.getByRole('button', { name: 'Add icon' }))
    await user.click(screen.getByRole('tab', { name: 'Emoji' }))
    await user.click(screen.getByRole('button', { name: 'rocket launch' }))
    expect(onPropertiesChange).toHaveBeenCalledWith({ icon: { type: 'emoji', val: '🚀' } })

    await user.click(screen.getByRole('button', { name: 'Add description' }))
    const description = screen.getByRole('textbox', { name: 'Description' })
    await user.type(description, 'A short note')
    fireEvent.blur(description)
    expect(onPropertiesChange).toHaveBeenLastCalledWith({ description: 'A short note' })

    // Both actions are offered only while the field is empty.
    expect(screen.getByRole('button', { name: 'Add cover image' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add aliases' })).toBeInTheDocument()
  })

  test('an existing icon opens the picker, and "Remove" clears it', async () => {
    const user = userEvent.setup()
    const onPropertiesChange = vi.fn()
    render(
      <ObjectHeader summary={page({ icon: '🚀' })} type={PAGE} onRename={vi.fn()} onPropertiesChange={onPropertiesChange} />,
    )
    expect(screen.queryByRole('button', { name: 'Add icon' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Change icon' }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onPropertiesChange).toHaveBeenCalledWith({ icon: null })
  })

  test('test tag object shows colour swatch that writes color', async () => {
    const user = userEvent.setup()
    const onPropertiesChange = vi.fn()
    render(
      <ObjectHeader
        summary={objectSummary({ path: 'Tags/Docs.md', type: 'tag', title: 'Docs', color: 'bg-red' })}
        type={TAG}
        onRename={vi.fn()}
        onPropertiesChange={onPropertiesChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Tag color' }))
    await user.click(screen.getByRole('button', { name: 'Teal' }))
    expect(onPropertiesChange).toHaveBeenCalledWith({ color: 'bg-teal' })

    // A page has no swatch.
    render(<ObjectHeader summary={page()} type={PAGE} onRename={vi.fn()} onPropertiesChange={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: 'Tag color' })).toHaveLength(1)
  })

  test('test daily note title read-only', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    render(
      <ObjectHeader
        summary={objectSummary({ path: 'DailyNotes/2026-10-23.md', type: 'dailynote', title: '2026-10-23' })}
        type={DAILY}
        onRename={onRename}
        onPropertiesChange={vi.fn()}
      />,
    )
    const title = screen.getByRole('textbox', { name: 'Title' })
    expect(title).toHaveAttribute('readonly')
    await user.type(title, 'x{Enter}')
    expect(title).toHaveValue('2026-10-23')
    expect(onRename).not.toHaveBeenCalled()
  })

  test('test tag chip coloured from tag object; click calls ensureTag then opens', async () => {
    const user = userEvent.setup()
    render(<ObjectHeader summary={page({ tags: ['Docs'] })} type={PAGE} onRename={vi.fn()} onPropertiesChange={vi.fn()} />)
    const chip = screen.getByRole('button', { name: 'Docs' })
    expect(chip.parentElement).toHaveStyle({ backgroundColor: 'var(--tag-bg-red)' })
    await user.click(chip)
    await waitFor(() => expect(mocked.ensureTag).toHaveBeenCalledWith('Docs'))
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Tags/Docs.md' }))
  })

  test('adding a new tag creates its Tag object', async () => {
    const user = userEvent.setup()
    const onPropertiesChange = vi.fn()
    render(<ObjectHeader summary={page({ tags: ['Docs'] })} type={PAGE} onRename={vi.fn()} onPropertiesChange={onPropertiesChange} />)
    await user.click(screen.getByRole('button', { name: 'Edit Tags' }))
    await user.type(screen.getByPlaceholderText('Search for tags or create one'), 'Physics')
    await user.click(screen.getByRole('option', { name: /Create 'Physics'/ }))
    expect(onPropertiesChange).toHaveBeenCalledWith({ tags: ['Docs', 'Physics'] })
    expect(mocked.ensureTag).toHaveBeenCalledWith('Physics')
    expect(mocked.ensureTag).not.toHaveBeenCalledWith('Docs')
  })
})
