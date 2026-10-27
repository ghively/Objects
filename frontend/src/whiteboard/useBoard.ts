/**
 * Loads a board into its store and saves it back.
 *
 * - Loading writes nothing (a board with no file reads as the empty board, `revision: ''`).
 * - Every local change (`boardSeq`) schedules a save 400 ms later; not while a drag is on; one
 *   save in flight at a time, the latest state queued behind it.
 * - On a 409 the server copy is fetched and this window's changes since the last save are merged
 *   onto it key by key (`mergeBoards`), then saved once with the new revision; a second 409
 *   reloads the server copy with the toast "Changed elsewhere. Reloaded.".
 * - A 423 switches the board to read-only.
 * - An external `whiteboard` change for this board reloads it (clearing the history) when
 *   nothing is pending here.
 * - Pending changes are flushed on unmount and on `pagehide`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ConflictError, ReadOnlyError } from '@/api/client'
import { whiteboardApi, type WhiteboardApi } from '@/api/whiteboardClient'
import type { WhiteboardData } from '@/api/whiteboardTypes'
import { mergeBoards } from './merge'
import { createBoardStore, type BoardStore, type CreateBoardStoreOptions } from './store'
import { WB } from './strings'

export const SAVE_DELAY_MS = 400

type BoardClient = Pick<WhiteboardApi, 'board' | 'saveBoard'>

export type BoardStatus = 'loading' | 'ready' | 'error'

export interface UseBoardResult {
  store: BoardStore
  status: BoardStatus
  error: string | null
  /** The toast to show ("Changed elsewhere. Reloaded."), until dismissed. */
  toast: string | null
  dismissToast(): void
  /** Saves pending changes now and waits for every save in flight. */
  flush(): Promise<void>
}

class BoardSaver {
  revision = ''
  /** The board as last loaded or saved: the merge base after a 409. */
  base: WhiteboardData | null = null
  savedSeq = 0
  timer: ReturnType<typeof setTimeout> | null = null
  inFlight: Promise<void> | null = null
  queued = false
  disposed = false
  readOnly = false

  readonly path: string
  readonly store: BoardStore
  readonly client: BoardClient
  readonly onToast: (text: string) => void

  constructor(path: string, store: BoardStore, client: BoardClient, onToast: (text: string) => void) {
    this.path = path
    this.store = store
    this.client = client
    this.onToast = onToast
  }

  get pending(): boolean {
    return this.timer !== null || this.inFlight !== null || this.store.getState().boardSeq !== this.savedSeq
  }

  adopt(board: WhiteboardData, revision: string): void {
    this.base = board
    this.revision = revision
    this.savedSeq = this.store.getState().boardSeq
  }

  schedule(): void {
    if (this.readOnly) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.store.getState().dragging) return // re-scheduled when the drag ends
    this.timer = setTimeout(() => {
      this.timer = null
      void this.save()
    }, SAVE_DELAY_MS)
  }

  save(): Promise<void> {
    if (this.readOnly) return Promise.resolve()
    if (this.inFlight) {
      this.queued = true
      return this.inFlight
    }
    const s = this.store.getState()
    if (s.boardSeq === this.savedSeq) return Promise.resolve()
    const board = s.doc.board
    const seq = s.boardSeq
    this.inFlight = this.client
      .saveBoard(this.path, board, this.revision)
      .then((res) => {
        this.base = board
        this.revision = res.revision
        this.savedSeq = Math.max(this.savedSeq, seq)
      })
      .catch((err: unknown) => this.failed(err, false))
      .finally(() => {
        this.inFlight = null
        const again = this.queued || this.store.getState().boardSeq !== this.savedSeq
        this.queued = false
        if (again && !this.disposed && !this.readOnly && !this.timer && !this.store.getState().dragging) void this.save()
      })
    return this.inFlight
  }

  private async failed(err: unknown, retried: boolean): Promise<void> {
    if (err instanceof ReadOnlyError) {
      this.readOnly = true
      this.store.getState().canvas.setReadOnly(err.message || WB.readOnly.text)
      return
    }
    if (!(err instanceof ConflictError)) {
      console.warn('Could not save the whiteboard:', err)
      return
    }
    let remote
    try {
      remote = await this.client.board(this.path)
    } catch (e) {
      console.warn('Could not reload the whiteboard:', e)
      return
    }
    if (retried) {
      this.reload(remote.board, remote.revision, remote.readOnlyReason ?? null)
      this.onToast(WB.changedElsewhere.text)
      return
    }
    const s = this.store.getState()
    const merged = mergeBoards(this.base, s.doc.board, remote.board)
    s.canvas.replaceBoard(merged)
    const seq = s.boardSeq
    try {
      const res = await this.client.saveBoard(this.path, merged, remote.revision)
      this.base = merged
      this.revision = res.revision
      this.savedSeq = Math.max(this.savedSeq, seq)
    } catch (e) {
      if (e instanceof ConflictError) await this.failed(e, true)
      else if (e instanceof ReadOnlyError) await this.failed(e, true)
      else console.warn('Could not save the whiteboard:', e)
    }
  }

  /** The server copy replaces everything here (history cleared). */
  reload(board: WhiteboardData, revision: string, readOnlyReason: string | null): void {
    const s = this.store.getState()
    s.canvas.load({ board, strokes: s.doc.strokes })
    this.adopt(board, revision)
    this.readOnly = !!readOnlyReason
    s.canvas.setReadOnly(readOnlyReason)
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    for (let i = 0; i < 5; i++) {
      if (this.inFlight) await this.inFlight
      else if (!this.readOnly && this.store.getState().boardSeq !== this.savedSeq) await this.save()
      else return
    }
  }
}

export function useBoard(
  path: string,
  client: BoardClient = whiteboardApi,
  storeOptions?: CreateBoardStoreOptions,
): UseBoardResult {
  const [store] = useState(() => createBoardStore(storeOptions))
  const [status, setStatus] = useState<BoardStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const saverRef = useRef<BoardSaver | null>(null)

  useEffect(() => {
    const saver = new BoardSaver(path, store, client, setToast)
    saverRef.current = saver
    let alive = true
    setStatus('loading')
    setError(null)
    client
      .board(path)
      .then((res) => {
        if (!alive) return
        saver.reload(res.board, res.revision, res.readOnlyReason ?? null)
        setStatus('ready')
      })
      .catch((e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : String(e))
        setStatus('error')
      })

    let lastSeq = store.getState().boardSeq
    let wasDragging = store.getState().dragging
    const unsubscribe = store.subscribe((s) => {
      if (s.boardSeq !== lastSeq) {
        lastSeq = s.boardSeq
        if (s.boardSeq !== saver.savedSeq) saver.schedule()
      }
      if (wasDragging && !s.dragging && s.boardSeq !== saver.savedSeq) saver.schedule()
      wasDragging = s.dragging
    })

    const offChange = api.onChange((e) => {
      if ((e.kind as string) !== 'whiteboard' || e.path !== path) return
      if (e.version && e.version === saver.revision) return
      if (saver.pending) return // our next save will meet the change (409) and merge
      void client
        .board(path)
        .then((res) => {
          if (!alive || saver.pending) return
          if (res.revision === saver.revision) return
          saver.reload(res.board, res.revision, res.readOnlyReason ?? null)
        })
        .catch(() => undefined)
    })

    const onPageHide = () => void saver.flush()
    window.addEventListener('pagehide', onPageHide)

    return () => {
      alive = false
      unsubscribe()
      offChange()
      window.removeEventListener('pagehide', onPageHide)
      void saver.flush().finally(() => {
        saver.disposed = true
      })
    }
  }, [path, client, store])

  const flush = useCallback(async () => {
    await saverRef.current?.flush()
  }, [])
  const dismissToast = useCallback(() => setToast(null), [])

  return { store, status, error, toast, dismissToast, flush }
}
