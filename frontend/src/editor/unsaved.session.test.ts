// The recovery store survives the page reload a space switch makes (session storage, per space).
import { beforeEach, describe, expect, test, vi } from 'vitest'

beforeEach(() => {
  sessionStorage.clear()
  vi.resetModules()
})

describe('unsaved edits across a reload', () => {
  test('test kept text survives a module reload in the same tab, per space', async () => {
    const first = await import('./unsaved')
    first.setUnsavedSpace('/spaces/a')
    first.keepUnsaved('Pages/Notes.md', 'mine\n')
    vi.resetModules() // the page reload of a space switch
    const second = await import('./unsaved')
    second.setUnsavedSpace('/spaces/b')
    expect(second.keptUnsaved('Pages/Notes.md')).toBeNull() // another space's file of the same name
    second.setUnsavedSpace('/spaces/a')
    expect(second.keptUnsaved('Pages/Notes.md')).toBe('mine\n')
    second.dropUnsaved('Pages/Notes.md')
    vi.resetModules()
    const third = await import('./unsaved')
    third.setUnsavedSpace('/spaces/a')
    expect(third.keptUnsaved('Pages/Notes.md')).toBeNull()
  })

  test('test a broken session store still keeps the text in memory', async () => {
    const m = await import('./unsaved')
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    m.setUnsavedSpace('/spaces/a')
    m.keepUnsaved('Pages/X.md', 'x\n')
    expect(m.keptUnsaved('Pages/X.md')).toBe('x\n')
    setItem.mockRestore()
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
