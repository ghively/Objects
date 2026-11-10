// M29 Task 8: the last type used, per viewer and per space, in localStorage.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setLastTypeSpace, useLastType } from './lastType'

beforeEach(async () => {
  localStorage.clear()
  await setLastTypeSpace(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('last type', () => {
  test("set('host') persists under object.lastType:<root>", async () => {
    await setLastTypeSpace('C:/Spaces/A')
    useLastType.getState().set('host')
    expect(useLastType.getState().typeId).toBe('host')
    expect(JSON.parse(localStorage.getItem('object.lastType:C:/Spaces/A') ?? 'null')).toEqual({ typeId: 'host' })
  })

  test("switching space gives that space's value", async () => {
    await setLastTypeSpace('A')
    useLastType.getState().set('host')
    await setLastTypeSpace('B')
    expect(useLastType.getState().typeId).toBeNull()
    useLastType.getState().set('network')
    await setLastTypeSpace('A')
    expect(useLastType.getState().typeId).toBe('host')
    await setLastTypeSpace('B')
    expect(useLastType.getState().typeId).toBe('network')
  })

  test('a missing or garbled stored value reads as null', async () => {
    await setLastTypeSpace('A')
    useLastType.getState().set('host')
    for (const raw of ['{not json', '"host"', '{"typeId": 5}', 'null', '[]', '{"typeId": ""}']) {
      localStorage.setItem('object.lastType:B', raw)
      await setLastTypeSpace('A')
      await setLastTypeSpace('B')
      expect({ raw, typeId: useLastType.getState().typeId }).toEqual({ raw, typeId: null })
    }
    localStorage.removeItem('object.lastType:B')
    await setLastTypeSpace('A')
    await setLastTypeSpace('B')
    expect(useLastType.getState().typeId).toBeNull()
  })

  test('localStorage throwing leaves typeId null and set still updates memory', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    await setLastTypeSpace('A')
    expect(useLastType.getState().typeId).toBeNull()
    useLastType.getState().set('host')
    expect(useLastType.getState().typeId).toBe('host')
  })
})
