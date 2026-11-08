import { describe, expect, test } from 'vitest'
import { deleteObjectsLabel } from './deleteText'

describe('deleteObjectsLabel', () => {
  test('counts the objects a delete button removes', () => {
    expect(deleteObjectsLabel(1)).toBe('Delete 1 object')
    expect(deleteObjectsLabel(3)).toBe('Delete 3 objects')
    expect(deleteObjectsLabel(0)).toBe('Delete 0 objects')
  })
})
