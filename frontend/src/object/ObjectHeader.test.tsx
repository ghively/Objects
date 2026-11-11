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
import { markFresh, resetFresh } from '@/create/freshObjects'
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
  resetFresh()
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
    expect(screen.getByPlaceholderText('Find a tag or type a new one')).toHaveValue('do')
    fireEvent.click(within(list).getByRole('option', { name: /Docs/ }))

    expect(onPropertiesChange).toHaveBeenCalledWith({ tags: ['Docs'] })
    expect(title).toHaveValue('Notes')
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Tags' })).not.toBeInTheDocument())
    fireEvent.blur(title)
    // The title is unchanged after the cut, so nothing is renamed.
    expect(onRename).not.toHaveBeenCalled()
  })

  test('test Escape commits the typed title and leaves the field', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    render(<ObjectHeader summary={page()} type={PAGE} onRename={onRename} onPropertiesChange={vi.fn()} />)
    const title = screen.getByRole('textbox', { name: 'Title' })
    await user.click(title)
    await user.keyboard('{Escape}')
    expect(title).not.toHaveFocus()
    expect(onRename).not.toHaveBeenCalled()

    await user.clear(title)
    await user.type(title, ' Plans {Escape}')
    expect(title).not.toHaveFocus()
    expect(title).toHaveValue('Plans')
    expect(onRename).toHaveBeenCalledExactlyOnceWith('Plans')
  })

  test.each([
    ['Enter', { isComposing: true }],
    ['Escape', { isComposing: true }],
    ['Enter', { keyCode: 229 }],
    ['Escape', { keyCode: 229 }],
  ])('test %s during IME composition (%o) leaves the half-typed title alone', (key, extra) => {
    const onRename = vi.fn()
    render(<ObjectHeader summary={page()} type={PAGE} onRename={onRename} onPropertiesChange={vi.fn()} />)
    const title = screen.getByRole('textbox', { name: 'Title' })
    title.focus()
    fireEvent.change(title, { target: { value: 'Notesに' } })
    const notCancelled = fireEvent.keyDown(title, { key, ...extra })
    expect(notCancelled).toBe(true)
    expect(title).toHaveFocus()
    expect(onRename).not.toHaveBeenCalled()
  })

  test('test Escape with an emptied title restores it and writes nothing', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    render(<ObjectHeader summary={page()} type={PAGE} onRename={onRename} onPropertiesChange={vi.fn()} />)
    const title = screen.getByRole('textbox', { name: 'Title' })
    await user.clear(title)
    await user.keyboard('{Escape}')
    expect(title).toHaveValue('Notes')
    expect(onRename).not.toHaveBeenCalled()
  })

  test('test Escape with the #tag picker open closes only the picker', async () => {
    const onRename = vi.fn()
    render(<ObjectHeader summary={page()} type={PAGE} onRename={onRename} onPropertiesChange={vi.fn()} />)
    const title = screen.getByRole('textbox', { name: 'Title' })
    title.focus()
    fireEvent.change(title, { target: { value: 'Notes #do', selectionStart: 9 } })
    await screen.findByRole('listbox', { name: 'Tags' })
    fireEvent.keyDown(title, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Tags' })).not.toBeInTheDocument())
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

  test('a freshly created object opens with its title focused and selected (M2#3)', async () => {
    markFresh('Pages/Notes.md')
    render(<ObjectHeader summary={page()} type={PAGE} onRename={vi.fn()} onPropertiesChange={vi.fn()} />)
    const title = screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement
    await waitFor(() => expect(title).toHaveFocus())
    expect([title.selectionStart, title.selectionEnd]).toEqual([0, 'Notes'.length])
  })

  test('an object that was not just created does not take the focus; the mark is used once', async () => {
    const { unmount } = render(<ObjectHeader summary={page()} type={PAGE} onRename={vi.fn()} onPropertiesChange={vi.fn()} />)
    await new Promise((r) => requestAnimationFrame(r))
    expect(screen.getByRole('textbox', { name: 'Title' })).not.toHaveFocus()
    unmount()
    markFresh('Pages/Notes.md')
    const first = render(<ObjectHeader summary={page()} type={PAGE} onRename={vi.fn()} onPropertiesChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus())
    first.unmount()
    render(<ObjectHeader summary={page()} type={PAGE} onRename={vi.fn()} onPropertiesChange={vi.fn()} />)
    await new Promise((r) => requestAnimationFrame(r))
    expect(screen.getByRole('textbox', { name: 'Title' })).not.toHaveFocus()
  })

  test('Add description puts the caret in the field it reveals', async () => {
    const user = userEvent.setup()
    render(<ObjectHeader summary={page()} type={PAGE} onRename={vi.fn()} onPropertiesChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Add description' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Description' })).toHaveFocus())
  })

  test('the Add icon and Add cover image triggers reach their button, so the popover can anchor to it', async () => {
    // Acceptance M2 #7: the popover's trigger passes its ref and props through `asChild`; a trigger that drops
    // them leaves the popover unpositioned (off screen at translate(0, -200%)) in a real browser.
    const user = userEvent.setup()
    render(<ObjectHeader summary={page()} type={PAGE} onRename={vi.fn()} onPropertiesChange={vi.fn()} />)
    for (const name of ['Add icon', 'Add cover image']) {
      const button = screen.getByRole('button', { name })
      expect(button).toHaveAttribute('aria-haspopup', 'dialog')
      await user.click(button)
      expect(button).toHaveAttribute('aria-expanded', 'true')
      await user.keyboard('{Escape}')
    }
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
    await user.type(screen.getByPlaceholderText('Find a tag or type a new one'), 'Physics')
    await user.click(screen.getByRole('option', { name: /Create 'Physics'/ }))
    expect(onPropertiesChange).toHaveBeenCalledWith({ tags: ['Docs', 'Physics'] })
    expect(mocked.ensureTag).toHaveBeenCalledWith('Physics')
    expect(mocked.ensureTag).not.toHaveBeenCalledWith('Docs')
  })

  // M32, wording: a type's name on screen goes through `typeLabel`.
  test('the type chip reads "Note" for the built-in Page and "Daily note" for DailyNote; a renamed type keeps its name', () => {
    const chip = () => document.querySelector('[data-type-chip]') as HTMLElement
    const first = render(<ObjectHeader summary={page()} type={PAGE} />)
    expect(chip()).toHaveTextContent(/^Note$/)
    first.unmount()
    const second = render(<ObjectHeader summary={page({ path: 'DailyNotes/2026-11-11.md', type: 'dailynote' })} type={DAILY} />)
    expect(chip()).toHaveTextContent(/^Daily note$/)
    second.unmount()
    render(<ObjectHeader summary={page()} type={typeDef({ id: 'page', name: 'Jotting', pluralName: 'Jottings' })} />)
    expect(chip()).toHaveTextContent(/^Jotting$/)
  })

  // M32, item 2: the title hands over to the body.
  test.each(['Enter', 'ArrowDown', 'Tab'])('%s in the title asks for the body, and the title commits as the focus leaves', async (key) => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    const body = document.createElement('textarea')
    document.body.append(body)
    const onEnterBody = vi.fn(() => {
      body.focus()
      return true
    })
    render(<ObjectHeader summary={page()} type={PAGE} onRename={onRename} onPropertiesChange={vi.fn()} onEnterBody={onEnterBody} />)
    const title = screen.getByRole('textbox', { name: 'Title' })
    await user.clear(title)
    await user.type(title, 'Plans')
    expect(fireEvent.keyDown(title, { key })).toBe(false)
    expect(onEnterBody).toHaveBeenCalledTimes(1)
    expect(body).toHaveFocus()
    expect(onRename).toHaveBeenCalledWith('Plans')
    body.remove()
  })

  test('with a modifier, with the #tag picker open, or in Escape, the body is not asked', async () => {
    const onEnterBody = vi.fn(() => true)
    render(<ObjectHeader summary={page()} type={PAGE} onRename={vi.fn()} onPropertiesChange={vi.fn()} onEnterBody={onEnterBody} />)
    const title = screen.getByRole('textbox', { name: 'Title' })
    title.focus()
    expect(fireEvent.keyDown(title, { key: 'Tab', shiftKey: true })).toBe(true)
    expect(fireEvent.keyDown(title, { key: 'ArrowDown', altKey: true })).toBe(true)
    fireEvent.keyDown(title, { key: 'Escape' })
    expect(onEnterBody).not.toHaveBeenCalled()
    title.focus()
    fireEvent.change(title, { target: { value: 'Notes #do', selectionStart: 9 } })
    await screen.findByRole('listbox', { name: 'Tags' })
    fireEvent.keyDown(title, { key: 'ArrowDown' })
    expect(onEnterBody).not.toHaveBeenCalled()
  })

  test('a body that cannot take the caret: Enter leaves the field as before, Tab is the browser\'s', async () => {
    const onEnterBody = vi.fn(() => false)
    render(<ObjectHeader summary={page()} type={PAGE} onRename={vi.fn()} onPropertiesChange={vi.fn()} onEnterBody={onEnterBody} />)
    const title = screen.getByRole('textbox', { name: 'Title' })
    title.focus()
    expect(fireEvent.keyDown(title, { key: 'Tab' })).toBe(true)
    expect(title).toHaveFocus()
    fireEvent.keyDown(title, { key: 'Enter' })
    expect(title).not.toHaveFocus()
  })
})
