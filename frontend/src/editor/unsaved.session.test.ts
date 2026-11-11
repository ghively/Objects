// The recovery store outlives the window (M32 fix pass, F2: local storage, per space and note; it
// was the tab's session storage, which a closed window takes with it). `vi.resetModules()` stands
// for a new page: a reload, or the app opened again after its window was closed.
import { beforeEach, describe, expect, test, vi } from 'vitest'

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  vi.resetModules()
})

describe('unsaved edits across a reload or a closed window', () => {
  test('test kept text is there for the next page, per space', async () => {
    const first = await import('./unsaved')
    first.setUnsavedSpace('/spaces/a')
    first.keepUnsaved('Pages/Notes.md', 'mine\n')
    // A closed window keeps nothing in its session storage: the text is not held there.
    expect(sessionStorage.length).toBe(0)
    vi.resetModules()
    const second = await import('./unsaved')
    second.setUnsavedSpace('/spaces/b')
    expect(second.keptUnsaved('Pages/Notes.md')).toBeNull() // another space's file of the same name
    expect(second.keptPaths()).toEqual([])
    second.setUnsavedSpace('/spaces/a')
    expect(second.keptUnsaved('Pages/Notes.md')).toBe('mine\n')
    expect(second.keptPaths()).toEqual(['Pages/Notes.md'])
    second.dropUnsaved('Pages/Notes.md')
    vi.resetModules()
    const third = await import('./unsaved')
    third.setUnsavedSpace('/spaces/a')
    expect(third.keptUnsaved('Pages/Notes.md')).toBeNull()
    expect(localStorage.length).toBe(0)
  })

  test('test a space whose folder name starts like another never sees its notes', async () => {
    const m = await import('./unsaved')
    m.setUnsavedSpace('/spaces/a')
    m.keepUnsaved('b/Notes.md', 'in a\n')
    m.setUnsavedSpace('/spaces/a/b')
    expect(m.keptUnsaved('Notes.md')).toBeNull()
    expect(m.keptPaths()).toEqual([])
    m.setUnsavedSpace('/spaces')
    expect(m.keptPaths()).toEqual([])
  })

  test('test two windows of one space see and keep each other\'s entries', async () => {
    const one = await import('./unsaved')
    one.setUnsavedSpace('/spaces/a')
    vi.resetModules()
    const two = await import('./unsaved')
    two.setUnsavedSpace('/spaces/a')
    one.keepUnsaved('Pages/One.md', 'one\n', 'id-1')
    two.keepUnsaved('Pages/Two.md', 'two\n', 'id-2')
    // Neither write replaced the other window's entry.
    expect(two.keptUnsaved('Pages/One.md', 'id-1')).toBe('one\n')
    expect(one.keptUnsaved('Pages/Two.md', 'id-2')).toBe('two\n')
    // A save that landed in one window clears the entry for both.
    two.dropUnsaved('Pages/One.md', 'id-1')
    expect(one.keptUnsaved('Pages/One.md', 'id-1')).toBeNull()
  })

  test('test a broken store still keeps the text in memory', async () => {
    const m = await import('./unsaved')
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    m.setUnsavedSpace('/spaces/a')
    m.keepUnsaved('Pages/X.md', 'x\n')
    expect(m.keptUnsaved('Pages/X.md')).toBe('x\n')
    expect(m.keptPaths()).toEqual(['Pages/X.md'])
    m.moveUnsaved('Pages/X.md', 'Pages/Y.md')
    expect(m.keptUnsaved('Pages/X.md')).toBeNull()
    expect(m.keptUnsaved('Pages/Y.md')).toBe('x\n')
    m.dropUnsaved('Pages/Y.md')
    expect(m.keptUnsaved('Pages/Y.md')).toBeNull()
    setItem.mockRestore()
  })

  test('test text kept in the session store by the version before is taken over once', async () => {
    sessionStorage.setItem('object.unsaved:/spaces/a', JSON.stringify({ 'Pages/X.md': { body: 'x\n', id: 'id-x' } }))
    const m = await import('./unsaved')
    m.setUnsavedSpace('/spaces/a')
    expect(m.keptUnsaved('Pages/X.md', 'id-x')).toBe('x\n')
    expect(sessionStorage.getItem('object.unsaved:/spaces/a')).toBeNull()
  })
})

describe('kept text and the object it belongs to', () => {
  test('is offered only to the same object (or when either id is unknown)', async () => {
    const m = await import('./unsaved')
    m.setUnsavedSpace('/spaces/a')
    m.keepUnsaved('Pages/Notes.md', 'mine\n', 'id-1')
    expect(m.keptUnsaved('Pages/Notes.md', 'id-1')).toBe('mine\n')
    expect(m.keptUnsaved('Pages/Notes.md')).toBe('mine\n')
    expect(m.keptUnsaved('Pages/Notes.md', 'id-2')).toBeNull() // another object made at that path
    m.dropUnsaved('Pages/Notes.md', 'id-2')
    expect(m.keptUnsaved('Pages/Notes.md', 'id-1')).toBe('mine\n')
    m.dropUnsaved('Pages/Notes.md', 'id-1')
    expect(m.keptUnsaved('Pages/Notes.md')).toBeNull()
  })

  test('moves with a rename, and the id survives a reload', async () => {
    const first = await import('./unsaved')
    first.setUnsavedSpace('/spaces/a')
    first.keepUnsaved('Pages/Old.md', 'mine\n', 'id-1')
    first.moveUnsaved('Pages/Old.md', 'Pages/New.md')
    vi.resetModules()
    const second = await import('./unsaved')
    second.setUnsavedSpace('/spaces/a')
    expect(second.keptUnsaved('Pages/Old.md')).toBeNull()
    expect(second.keptUnsaved('Pages/New.md', 'id-2')).toBeNull()
    expect(second.keptUnsaved('Pages/New.md', 'id-1')).toBe('mine\n')
  })

  test('text kept before ids were stored still loads', async () => {
    sessionStorage.setItem('object.unsaved:/spaces/a', JSON.stringify({ 'Pages/X.md': 'x\n' }))
    const m = await import('./unsaved')
    m.setUnsavedSpace('/spaces/a')
    expect(m.keptUnsaved('Pages/X.md', 'any')).toBe('x\n')
  })
})

describe('text the file already holds', () => {
  const notes: Record<string, { body: string; id: string | null }> = {
    'Pages/Landed.md': { body: 'typed, and saved after the window had gone\n', id: 'id-1' },
    'Pages/Cut.md': { body: 'the text before\n', id: 'id-2' },
    'Pages/Other.md': { body: 'same words\n', id: 'id-9' },
  }
  const readNote = async (path: string) => {
    if (!notes[path]) throw new Error('Not found')
    return notes[path]
  }

  test('test forgetSaved clears an entry whose save landed, and keeps the ones the file does not hold', async () => {
    const m = await import('./unsaved')
    m.setUnsavedSpace('/spaces/a')
    m.keepUnsaved('Pages/Landed.md', 'typed, and saved after the window had gone\n', 'id-1')
    m.keepUnsaved('Pages/Cut.md', 'the text before, and words the close cut off\n', 'id-2')
    m.keepUnsaved('Pages/Gone.md', 'a note deleted since\n', 'id-3')
    // Another object now sits at this path: the text is not its own, whatever it says.
    m.keepUnsaved('Pages/Other.md', 'same words\n', 'id-4')
    await m.forgetSaved(readNote)
    expect(m.keptUnsaved('Pages/Landed.md')).toBeNull()
    expect(m.keptUnsaved('Pages/Cut.md', 'id-2')).toBe('the text before, and words the close cut off\n')
    expect(m.keptUnsaved('Pages/Gone.md')).toBe('a note deleted since\n')
    expect(m.keptUnsaved('Pages/Other.md', 'id-4')).toBe('same words\n')
  })

  test('test forgetSaved reads nothing when nothing is kept', async () => {
    const m = await import('./unsaved')
    m.setUnsavedSpace('/spaces/a')
    const read = vi.fn(readNote)
    await m.forgetSaved(read)
    expect(read).not.toHaveBeenCalled()
  })
})
