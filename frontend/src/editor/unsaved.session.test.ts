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
