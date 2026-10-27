/**
 * Undo/redo of whole documents (board plus ink). Each entry is a snapshot; `push` records the
 * document after a change. A push with the same `coalesceKey` as the newest entry (and nothing
 * undone since) replaces that entry, so one drag gesture is one step. At most 200 steps are kept.
 */

export const HISTORY_CAP = 200

interface Entry<T> {
  doc: T
  label: string
  key: string | null
}

export class History<T> {
  private entries: Entry<T>[]
  private index = 0
  private readonly cap: number

  /** `initial` is the document as loaded (the state undo returns to at the bottom). */
  constructor(initial: T, cap = HISTORY_CAP) {
    this.entries = [{ doc: initial, label: '', key: null }]
    this.cap = Math.max(1, cap)
  }

  /** The current document. */
  get current(): T {
    return this.entries[this.index].doc
  }

  get canUndo(): boolean {
    return this.index > 0
  }

  get canRedo(): boolean {
    return this.index < this.entries.length - 1
  }

  /** The label of the step `undo` would revert, or `null`. */
  get undoLabel(): string | null {
    return this.canUndo ? this.entries[this.index].label : null
  }

  /** The label of the step `redo` would re-apply, or `null`. */
  get redoLabel(): string | null {
    return this.canRedo ? this.entries[this.index + 1].label : null
  }

  /** The number of undoable steps. */
  get size(): number {
    return this.index
  }

  push(doc: T, label: string, coalesceKey?: string | null): void {
    const key = coalesceKey ?? null
    const top = this.entries[this.index]
    const atTop = this.index === this.entries.length - 1
    if (key !== null && atTop && this.index > 0 && top.key === key) {
      this.entries[this.index] = { doc, label, key }
      return
    }
    this.entries.length = this.index + 1
    this.entries.push({ doc, label, key })
    this.index++
    const overflow = this.entries.length - 1 - this.cap
    if (overflow > 0) {
      this.entries.splice(0, overflow)
      this.index -= overflow
    }
  }

  /** Ends coalescing: the next push starts a new step even with the same key. */
  seal(): void {
    const top = this.entries[this.index]
    if (top.key !== null) this.entries[this.index] = { ...top, key: null }
  }

  /** Steps back; returns the document to restore, or `null` when there is nothing to undo. */
  undo(): T | null {
    if (!this.canUndo) return null
    this.seal()
    this.index--
    return this.entries[this.index].doc
  }

  /** Steps forward; returns the document to restore, or `null`. */
  redo(): T | null {
    if (!this.canRedo) return null
    this.index++
    return this.entries[this.index].doc
  }

  /** Forgets every step (an external reload): `doc` becomes the bottom. */
  reset(doc: T): void {
    this.entries = [{ doc, label: '', key: null }]
    this.index = 0
  }
}
