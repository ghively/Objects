/**
 * "Add to whiteboard" (`Whiteboard.addTo.action`, M8 Task 22): pick a board, or "New whiteboard"
 * (`addToNewWhiteboard.title`), and the object is placed on it as an entity node right of the
 * board's existing content (`placeObjectOnBoard`). Creating a board that fails shows
 * "Could not create whiteboard" (`Whiteboard.turnInto.failed`). A board can't be added to itself
 * (our choice: it isn't listed). Mounted once in `shell/GlobalOverlays.tsx`; `useAddToWhiteboard`
 * opens it (the object menu, and `addObjectToWhiteboard`, which waits for the outcome).
 */
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import type { ObjectSummary } from '@/api/types'
import { whiteboardApi, type WhiteboardApi } from '@/api/whiteboardClient'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { showToast } from '@/editor/media/upload'
import { invalidateLinkIndex, stemOf, typeOf, useLinkIndex } from '@/links/linkIndex'
import { create } from 'zustand'
import { isWhiteboardType } from './isWhiteboard'
import { placeObjectOnBoard, TURN_INTO_FAILED } from './turnInto'

/** `Whiteboard.addTo.action` */
export const ADD_TO_WHITEBOARD = 'Add to whiteboard'
/** `CommandPalette.actions.addToNewWhiteboard.title` */
export const NEW_WHITEBOARD = 'New whiteboard'
/** Our strings. */
export const SEARCH_WHITEBOARDS = 'Search whiteboards'
export const NO_WHITEBOARDS = 'No whiteboards found'
export function addedTo(title: string): string {
  return `Added to ${title}`
}

/** The dialog's outcome for a caller that waits (`addObjectToWhiteboard`). */
export interface AddToWhiteboardPending {
  resolve(boardPath: string): void
  reject(reason: unknown): void
}

export interface AddToWhiteboardState {
  /** The object to add; null when closed. */
  objectPath: string | null
  pending: AddToWhiteboardPending | null
  open(path: string, pending?: AddToWhiteboardPending): void
  close(): void
}

/** Rejection reason when the dialog is closed without adding. */
export class AddToWhiteboardCancelled extends Error {
  constructor() {
    super('Add to whiteboard was cancelled')
    this.name = 'AddToWhiteboardCancelled'
  }
}

export const useAddToWhiteboard = create<AddToWhiteboardState>((set, get) => ({
  objectPath: null,
  pending: null,
  open: (path, pending) => {
    get().pending?.reject(new AddToWhiteboardCancelled())
    set({ objectPath: path, pending: pending ?? null })
  },
  close: () => {
    get().pending?.reject(new AddToWhiteboardCancelled())
    set({ objectPath: null, pending: null })
  },
}))

/** Settles the waiting caller with `boardPath` and closes. */
function finish(boardPath: string) {
  const { pending } = useAddToWhiteboard.getState()
  useAddToWhiteboard.setState({ objectPath: null, pending: null })
  pending?.resolve(boardPath)
}

export interface AddToWhiteboardDialogProps {
  /** Tests inject the whiteboard routes. */
  client?: Pick<WhiteboardApi, 'board' | 'saveBoard' | 'createWhiteboard'>
}

export function AddToWhiteboardDialog({ client = whiteboardApi }: AddToWhiteboardDialogProps = {}) {
  const objectPath = useAddToWhiteboard((s) => s.objectPath)
  const close = useAddToWhiteboard((s) => s.close)
  return (
    <Dialog open={objectPath !== null} onOpenChange={(o) => !o && close()}>
      {objectPath !== null && (
        <DialogContent
          className="w-[min(440px,calc(100vw-32px))] gap-0 overflow-hidden border-line bg-raised-2 p-0 text-fg"
          data-add-to-whiteboard=""
        >
          <DialogTitle className="px-4 pt-4 pb-2 text-[15px] font-semibold">{ADD_TO_WHITEBOARD}</DialogTitle>
          <DialogDescription className="sr-only">{SEARCH_WHITEBOARDS}</DialogDescription>
          <BoardList key={objectPath} objectPath={objectPath} client={client} />
        </DialogContent>
      )}
    </Dialog>
  )
}

function BoardList({
  objectPath,
  client,
}: {
  objectPath: string
  client: Pick<WhiteboardApi, 'board' | 'saveBoard' | 'createWhiteboard'>
}) {
  const types = useLinkIndex((s) => s.types)
  const [objects, setObjects] = useState<ObjectSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api
      .objects()
      .then((list) => live && setObjects(list))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [])

  const boards = useMemo(() => {
    if (!objects) return []
    const boardTypes = new Set(types.filter(isWhiteboardType).map((t) => t.id))
    const needle = query.trim().toLowerCase()
    return objects
      .filter((o) => o.type !== null && o.type !== undefined && boardTypes.has(o.type) && o.path !== objectPath)
      .filter((o) => !needle || o.title.toLowerCase().includes(needle))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
  }, [objects, types, query, objectPath])

  const addTo = async (boardPath: string, title: string) => {
    await placeObjectOnBoard(boardPath, objectPath, client)
    showToast(addedTo(title))
    finish(boardPath)
  }

  const pick = async (board: ObjectSummary) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await addTo(board.path, board.title)
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const createNew = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    let path: string
    try {
      path = (await client.createWhiteboard()).path
      void invalidateLinkIndex()
    } catch {
      setError(TURN_INTO_FAILED)
      setBusy(false)
      return
    }
    try {
      await addTo(path, stemOf(path))
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Command shouldFilter={false} className="bg-transparent">
        <CommandInput autoFocus value={query} onValueChange={setQuery} placeholder={SEARCH_WHITEBOARDS} aria-label={SEARCH_WHITEBOARDS} />
        <CommandList className="max-h-80">
          <CommandGroup>
            <CommandItem value="__new" disabled={busy} onSelect={() => void createNew()}>
              <Icon name="ph-plus" size={16} />
              <span className="flex-1 truncate">{NEW_WHITEBOARD}</span>
            </CommandItem>
          </CommandGroup>
          {objects && boards.length === 0 && (
            <p className="px-3 py-2 text-[13px] text-fg-muted" data-add-to-whiteboard-empty="">
              {NO_WHITEBOARDS}
            </p>
          )}
          {boards.length > 0 && (
            <CommandGroup>
              {boards.map((o) => (
                <CommandItem key={o.path} value={o.path} disabled={busy} onSelect={() => void pick(o)}>
                  <IconOrEmoji icon={o.icon ?? typeOf(o.type)?.icon} fallback="ph-chalkboard-simple" size={16} />
                  <span className="flex-1 truncate">{o.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
      {error && (
        <p role="alert" className="border-t border-line px-4 py-2 text-[13px] text-red-400">
          {error}
        </p>
      )}
    </>
  )
}

export default AddToWhiteboardDialog
