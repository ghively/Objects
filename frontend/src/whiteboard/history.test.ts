import { describe, expect, test } from 'vitest'
import { HISTORY_CAP, History } from './history'

type Doc = { n: number; list: number[] }
const doc = (n: number): Doc => ({ n, list: [n] })

describe('History', () => {
  test('history coalesces a drag into one step', () => {
    const h = new History<Doc>(doc(0))
    h.push(doc(1), 'move', 'drag-1')
    h.push(doc(2), 'move', 'drag-1')
    h.push(doc(3), 'move', 'drag-1')
    expect(h.size).toBe(1)
    expect(h.current).toEqual(doc(3))
    expect(h.undo()).toEqual(doc(0))
    expect(h.canUndo).toBe(false)
    expect(h.redo()).toEqual(doc(3))
  })

  test('a different key, no key or a sealed step starts a new step', () => {
    const h = new History<Doc>(doc(0))
    h.push(doc(1), 'move', 'a')
    h.push(doc(2), 'move', 'b')
    h.push(doc(3), 'edit')
    h.push(doc(4), 'edit')
    expect(h.size).toBe(4)
    h.push(doc(5), 'move', 'c')
    h.seal()
    h.push(doc(6), 'move', 'c')
    expect(h.size).toBe(6)
  })

  test('undo redo restore exact documents', () => {
    const docs = [doc(0), doc(1), doc(2), doc(3)]
    const h = new History<Doc>(docs[0])
    h.push(docs[1], 'a')
    h.push(docs[2], 'b')
    h.push(docs[3], 'c')
    expect(h.undoLabel).toBe('c')
    expect(h.undo()).toBe(docs[2])
    expect(h.undo()).toBe(docs[1])
    expect(h.redoLabel).toBe('b')
    expect(h.redo()).toBe(docs[2])
    expect(h.undo()).toBe(docs[1])
    expect(h.undo()).toBe(docs[0])
    expect(h.undo()).toBeNull()
    expect(h.redo()).toBe(docs[1])
    // a new push after undo drops the redo branch
    h.push(doc(9), 'z')
    expect(h.canRedo).toBe(false)
    expect(h.redo()).toBeNull()
    expect(h.undo()).toBe(docs[1])
  })

  test('undo ends coalescing: the same key after undo is a new step', () => {
    const h = new History<Doc>(doc(0))
    h.push(doc(1), 'move', 'k')
    h.push(doc(2), 'move', 'k')
    h.undo()
    h.redo()
    h.push(doc(3), 'move', 'k')
    expect(h.size).toBe(2)
    expect(h.undo()).toEqual(doc(2))
  })

  test('history cap 200', () => {
    expect(HISTORY_CAP).toBe(200)
    const h = new History<Doc>(doc(0))
    for (let i = 1; i <= 250; i++) h.push(doc(i), 'step')
    expect(h.size).toBe(200)
    let last: Doc | null = null
    while (h.canUndo) last = h.undo()
    expect(last).toEqual(doc(50))
  })

  test('reset forgets every step', () => {
    const h = new History<Doc>(doc(0))
    h.push(doc(1), 'a')
    h.reset(doc(7))
    expect(h.canUndo).toBe(false)
    expect(h.canRedo).toBe(false)
    expect(h.current).toEqual(doc(7))
  })
})
