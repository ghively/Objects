import { afterEach, describe, expect, test } from 'vitest'
import { announceRelinked, relinkedObjectCount, relinkedText } from './relinkNotice'

function toasts(): string[] {
  return [...document.querySelectorAll('[data-editor-toasts] [role=status]')].map((el) => el.textContent ?? '')
}

afterEach(() => {
  document.querySelector('[data-editor-toasts]')?.remove()
})

describe('the rename notice (M2#8)', () => {
  test('counts the other objects: a board file is its object, the renamed one is left out', () => {
    expect(
      relinkedObjectCount({
        path: 'Pages/New.md',
        relinked: ['Pages/A.md', 'Boards/B.whiteboard.json', 'Boards/B.md', 'Pages/New.whiteboard.json', 'Pages/C.md'],
      }),
    ).toBe(3)
    expect(relinkedObjectCount({ path: 'Pages/New.md', relinked: [] })).toBe(0)
  })

  test('reads "Updated links in N notes", singular for one, nothing for none', () => {
    expect(relinkedText(3)).toBe('Updated links in 3 notes')
    expect(relinkedText(1)).toBe('Updated links in 1 note')
    expect(relinkedText(0)).toBeNull()
  })

  test('announceRelinked shows the toast only when links were updated', () => {
    announceRelinked({ path: 'Pages/New.md', relinked: [] })
    expect(toasts()).toEqual([])
    announceRelinked({ path: 'Pages/New.md', relinked: ['Pages/A.md', 'Pages/B.md'] })
    expect(toasts()).toEqual(['Updated links in 2 notes'])
  })
})
