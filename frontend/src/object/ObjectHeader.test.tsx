import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
import { ObjectHeader, TITLE_COMMIT_MS } from './ObjectHeader'

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

// The hands-on walk, W1 (Critical): a typed title was saved only on Enter, Tab or a click
// elsewhere, so "New note", a title, and a closed window lost the title. The title is now kept
// like the text: committed after a pause in typing, without disturbing the person.
describe('a typed title is committed after a pause (W1)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const type = (title: HTMLElement, value: string) => fireEvent.change(title, { target: { value, selectionStart: value.length } })
  const wait = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms))

  function mount(onRename: (title: string) => void | Promise<boolean> = vi.fn(), extra: Partial<Parameters<typeof ObjectHeader>[0]> = {}) {
    const utils = render(<ObjectHeader summary={page()} type={PAGE} onRename={onRename} onPropertiesChange={vi.fn()} {...extra} />)
    const title = screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement
    act(() => title.focus())
    return { ...utils, title }
  }

  test('test 2 s after the last key the title is committed once, with the focus and the selection where they were', async () => {
    const onRename = vi.fn()
    const { title } = mount(onRename)
    type(title, 'Plans for May ')
    title.setSelectionRange(2, 5)
    await wait(TITLE_COMMIT_MS - 1)
    expect(onRename).not.toHaveBeenCalled()
    await wait(1)
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenCalledWith('Plans for May')
    // Nothing about the field changed: the text as typed (the space too), the focus, the selection.
    expect(title).toHaveFocus()
    expect(title).toHaveValue('Plans for May ')
    expect([title.selectionStart, title.selectionEnd]).toEqual([2, 5])
    await wait(10_000)
    expect(onRename).toHaveBeenCalledTimes(1)
  })

  test('test typing that goes on does not commit; the pause after it does', async () => {
    const onRename = vi.fn()
    const { title } = mount(onRename)
    let text = ''
    for (const ch of 'Plans for May') {
      text += ch
      type(title, text)
      await wait(700) // 9 s of typing, never 2 s quiet
    }
    expect(onRename).not.toHaveBeenCalled()
    await wait(TITLE_COMMIT_MS - 700)
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenCalledWith('Plans for May')
  })

  test('test keys typed while the rename is on its way are kept, and committed after the next pause', async () => {
    let done!: (ok: boolean) => void
    const onRename = vi.fn(() => new Promise<boolean>((r) => (done = r)))
    const { title, rerender } = mount(onRename)
    type(title, 'Plans')
    await wait(TITLE_COMMIT_MS)
    expect(onRename).toHaveBeenCalledWith('Plans')
    type(title, 'Plans for May')
    // The server's answer: the note is now called "Plans". The field's own text wins.
    await act(async () => done(true))
    rerender(<ObjectHeader summary={page({ title: 'Plans' })} type={PAGE} onRename={onRename} onPropertiesChange={vi.fn()} />)
    expect(title).toHaveValue('Plans for May')
    expect(title).toHaveFocus()
    await wait(TITLE_COMMIT_MS)
    expect(onRename).toHaveBeenCalledTimes(2)
    expect(onRename).toHaveBeenLastCalledWith('Plans for May')
  })

  test.each([
    ['an emptied title', ''],
    ['a title of spaces', '   '],
    ['the title it already has', 'Notes'],
    ['the same title with spaces around it', '  Notes '],
  ])('test %s is not committed by the timer', async (_name, value) => {
    const onRename = vi.fn()
    const { title } = mount(onRename)
    type(title, value)
    await wait(10_000)
    expect(onRename).not.toHaveBeenCalled()
    expect(title).toHaveValue(value) // the person may be retyping: the field is left alone
  })

  test('test a title the server refuses keeps the draft and is not sent again until it changes', async () => {
    const onRename = vi.fn(async () => false)
    const { title } = mount(onRename)
    type(title, 'Taken')
    await wait(TITLE_COMMIT_MS)
    expect(onRename).toHaveBeenCalledTimes(1)
    await wait(60_000)
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(title).toHaveValue('Taken')
    expect(title).toHaveFocus()
    // A changed title is a new try.
    type(title, 'Taken 2')
    await wait(TITLE_COMMIT_MS)
    expect(onRename).toHaveBeenCalledTimes(2)
    expect(onRename).toHaveBeenLastCalledWith('Taken 2')
  })

  test('test the #tag picker open holds the commit; it follows once the tag is picked', async () => {
    const onRename = vi.fn()
    const { title } = mount(onRename)
    fireEvent.change(title, { target: { value: 'Plans #do', selectionStart: 9 } })
    await wait(10_000)
    expect(onRename).not.toHaveBeenCalled()
    fireEvent.keyDown(title, { key: 'Escape' })
    type(title, 'Plans')
    await wait(TITLE_COMMIT_MS)
    expect(onRename).toHaveBeenCalledWith('Plans')
  })

  test('test an IME composition is never cut by the commit', async () => {
    const onRename = vi.fn()
    const { title } = mount(onRename)
    fireEvent.compositionStart(title)
    type(title, 'にほ')
    await wait(10_000)
    expect(onRename).not.toHaveBeenCalled()
    fireEvent.compositionEnd(title)
    type(title, '日本')
    await wait(TITLE_COMMIT_MS)
    expect(onRename).toHaveBeenCalledWith('日本')
  })

  test('test the view is told the title that waits, so it can commit it when the note is left', async () => {
    const onDraft = vi.fn()
    const { title } = mount(vi.fn(), { onDraft })
    type(title, ' Plans ')
    expect(onDraft).toHaveBeenLastCalledWith('Plans')
    type(title, '')
    expect(onDraft).toHaveBeenLastCalledWith(null)
    type(title, 'Notes')
    expect(onDraft).toHaveBeenLastCalledWith(null)
  })

  test('test a read-only note and a daily note commit nothing', async () => {
    const onRename = vi.fn()
    render(<ObjectHeader summary={page({ type: 'dailynote' })} type={DAILY} onRename={onRename} onPropertiesChange={vi.fn()} />)
    const title = screen.getByRole('textbox', { name: 'Title' })
    type(title, 'Other')
    await wait(10_000)
    expect(onRename).not.toHaveBeenCalled()
  })

  test('test a blur commits at once and the timer does not send it a second time', async () => {
    const onRename = vi.fn()
    const { title } = mount(onRename)
    type(title, 'Plans')
    act(() => title.blur())
    expect(onRename).toHaveBeenCalledTimes(1)
    await wait(10_000)
    expect(onRename).toHaveBeenCalledTimes(1)
  })
})
