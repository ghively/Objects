import { describe, expect, test } from 'vitest'
import { create } from 'zustand'
import { followStorage, switchStoreSpace } from './spaceStorage'

// pywebview's Linux (GTK) backend in private mode turns localStorage off; zustand's `persist`
// then adds no `persist` API, and the main pane crashed on `store.persist.getOptions()`.
describe('spaceStorage without a persist API', () => {
  test('switchStoreSpace and followStorage leave a store with no storage alone', async () => {
    const store = create<{ ids: string[] }>(() => ({ ids: ['a'] }))
    await expect(switchStoreSpace(store, 'object.tabs', '/space', { ids: [] })).resolves.toBeUndefined()
    expect(store.getState().ids).toEqual(['a'])
    const stop = followStorage(store, () => ({ ids: ['b'] }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'object.tabs', newValue: '{"state":{"ids":["b"]}}' }))
    expect(store.getState().ids).toEqual(['a'])
    stop()
  })
})
