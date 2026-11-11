import { describe, expect, test } from 'vitest'
import { deleteObjectsLabel } from './deleteText'

describe('deleteObjectsLabel', () => {
  test('counts the notes a delete button removes (M32: "note", never "object")', () => {
    expect(deleteObjectsLabel(1)).toBe('Delete 1 note')
    expect(deleteObjectsLabel(3)).toBe('Delete 3 notes')
    expect(deleteObjectsLabel(0)).toBe('Delete 0 notes')
  })
})
