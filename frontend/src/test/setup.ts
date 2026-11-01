import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { resetUnsaved } from '@/editor/unsaved'

afterEach(() => {
  cleanup()
})

// Edits kept by an editor that a test left unsaved (e.g. unmounted with the conflict
// dialog open) would be offered to the next test that opens the same path.
beforeEach(() => {
  resetUnsaved()
})

// jsdom lacks ResizeObserver, which Radix ScrollArea and Tooltip use.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

// jsdom's Range has no layout methods; ProseMirror's scrollIntoView (a focus
// command's delayed frame) measures a text Range and would throw.
if (typeof Range !== 'undefined') {
  const proto = Range.prototype as unknown as {
    getClientRects?: () => DOMRectList
    getBoundingClientRect?: () => DOMRect
  }
  proto.getClientRects ??= () => [] as unknown as DOMRectList
  proto.getBoundingClientRect ??= () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect
}
