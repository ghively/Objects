// M32: "New means a note".
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { useLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { typeDef } from '@/test/mockApi'
import { resetFresh, takeFresh } from './freshObjects'
import { setLastTypeSpace, useLastType } from './lastType'
import { NEW_NOTE_FAILED, newNote, noteTypeId } from './newNote'
import { suggestFor } from './suggestContext'

const mocked = vi.mocked(api)
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })
const TASK = typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks', basic: true })

beforeEach(async () => {
  vi.clearAllMocks()
  localStorage.clear()
  document.querySelector('[data-editor-toasts]')?.remove()
  await setLastTypeSpace(null)
  useTabs.getState().reset()
  usePeek.getState().close()
  resetFresh()
  useSettings.setState({ settings: settingsDefaults })
  useLinkIndex.setState({ types: [TASK, PAGE], objects: [], loaded: true })
})

describe('newNote (M32)', () => {
  test('test noteTypeId is the Page type, else page', () => {
    expect(noteTypeId([TASK, PAGE])).toBe('page')
    expect(noteTypeId([typeDef({ id: 'p9', name: 'Page' })])).toBe('p9')
    expect(noteTypeId([])).toBe('page')
  })

  test('test a new note is a Note whatever was made last, opens in the tab and is marked fresh (title focus)', async () => {
    useLastType.getState().set('task')
    mocked.createObject.mockResolvedValueOnce({ path: 'Pages/Untitled.md', version: 'v1' })
    await newNote()
    expect(mocked.createObject).toHaveBeenCalledWith('page', {})
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Pages/Untitled.md' })
    expect(usePeek.getState().path).toBeNull()
    expect(takeFresh('Pages/Untitled.md')).toBe(true)
  })

  test('test the modifier keys say where it opens; a type can be given', async () => {
    useTabs.getState().open({ kind: 'trash' })
    mocked.createObject.mockResolvedValueOnce({ path: 'Tasks/Untitled.md', version: 'v1' })
    await newNote({ ctrlKey: true }, 'task')
    expect(mocked.createObject).toHaveBeenCalledWith('task', {})
    expect(useTabs.getState().tabs).toHaveLength(2)
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Tasks/Untitled.md' })
  })

  test('test a failure shows its message as a toast and never rejects', async () => {
    mocked.createObject.mockRejectedValueOnce(new Error('The space is read-only.'))
    await expect(newNote()).resolves.toBeUndefined()
    expect(document.querySelector('[data-editor-toasts]')?.textContent).toContain('The space is read-only.')
    mocked.createObject.mockRejectedValueOnce('nope')
    await newNote()
    expect(document.querySelector('[data-editor-toasts]')?.textContent).toContain(NEW_NOTE_FAILED)
  })

  // The M32 review, F4: a double click on "New" wrote Untitled.md and Untitled (2).md.
  test('test a second ask while a note is being made makes no second note', async () => {
    let made!: (r: { path: string; version: string }) => void
    mocked.createObject.mockImplementationOnce(() => new Promise((r) => (made = r)))
    const first = newNote()
    const second = newNote()
    const third = newNote({ ctrlKey: true }, 'task')
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(mocked.createObject).toHaveBeenCalledTimes(1)
    made({ path: 'Pages/Untitled.md', version: 'v1' })
    await first
    expect(useTabs.getState().tabs).toHaveLength(1)
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Pages/Untitled.md' })
    // Once it is made, "New" makes the next one.
    mocked.createObject.mockResolvedValueOnce({ path: 'Pages/Untitled (2).md', version: 'v1' })
    await newNote()
    expect(mocked.createObject).toHaveBeenCalledTimes(2)
  })

  test('test a failed create does not block the next one', async () => {
    mocked.createObject.mockRejectedValueOnce(new Error('The space is read-only.'))
    await newNote()
    mocked.createObject.mockResolvedValueOnce({ path: 'Pages/Untitled.md', version: 'v1' })
    await newNote()
    expect(mocked.createObject).toHaveBeenCalledTimes(2)
  })

  test('test suggestFor with last: false leaves the last type out (the palette makes a Note)', () => {
    useLastType.getState().set('task')
    expect(suggestFor('Fresh idea', [PAGE, TASK])).toEqual(['task'])
    expect(suggestFor('Fresh idea', [PAGE, TASK], { last: false })).toEqual([])
    // The active page's type still counts.
    useTabs.getState().open({ kind: 'type', typeId: 'task' })
    expect(suggestFor('Fresh idea', [PAGE, TASK], { last: false })).toEqual(['task'])
  })
})
