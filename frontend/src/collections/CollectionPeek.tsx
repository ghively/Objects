/**
 * M31 item 7: the collection peek (catalog section 9, "Collection page: opens in a peek"): a modal
 * like the object peek, showing `CollectionPage` in its `peek` layout, with a stepper ("1 / 3")
 * through the type's collections at the bottom right. Expand ("Open as page") opens the tab page.
 *
 * Our calls: a plain click on a collection tile in a type's Overview opens the peek (Ctrl or Cmd
 * opens the page in a new tab); the sidebar, pins, the tab menu's "Open" and links still open the
 * page. The peek closes when the main view goes somewhere else (expand, the type chip, a created
 * object opened as a page), and an object opened from it shows in the object peek over it.
 */
import { useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Icon } from '@/components/Icon'
import { currentTarget, useCollectionPeek, useTabs, type Target } from '@/nav/tabs'
import { useDefs } from '@/types/useDefinitions'
import { COLLECTION_PAGE_TEXT, CollectionPage } from './CollectionPage'

export const COLLECTION_PEEK_TEXT = {
  expand: COLLECTION_PAGE_TEXT.expand,
  newObject: COLLECTION_PAGE_TEXT.createEntry,
  /** our string (screen readers) */
  description: 'Collection preview',
}

function Stepper() {
  const { index, list, next, prev } = useCollectionPeek()
  if (list.length < 2) return null
  return (
    <div data-testid="collection-peek-stepper" className="flex items-center gap-1 rounded-xl border border-line bg-raised-2 py-1 pr-1 pl-3 text-[15px]">
      <span className="tabular-nums">{`${index + 1} / ${list.length}`}</span>
      <button
        type="button"
        aria-label="Previous"
        onClick={prev}
        disabled={index <= 0}
        className="flex size-8 items-center justify-center rounded-md hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Icon name="ph-caret-left" size={16} />
      </button>
      <button
        type="button"
        aria-label="Next"
        onClick={next}
        disabled={index >= list.length - 1}
        className="flex size-8 items-center justify-center rounded-md hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Icon name="ph-caret-right" size={16} />
      </button>
    </div>
  )
}

const targetKey = (t: Target | null | undefined) => (t ? JSON.stringify(t) : '')

export function CollectionPeek() {
  const id = useCollectionPeek((s) => s.id)
  const typeId = useCollectionPeek((s) => s.typeId)
  const close = useCollectionPeek((s) => s.close)
  const name = useDefs((s) => (id ? s.collections.find((c) => c.id === id)?.name : undefined))
  // The main view moved on: the peek goes (it belongs to the page it opened over).
  const mainKey = useTabs((s) => targetKey(currentTarget(s)))
  const seen = useRef(mainKey)
  useEffect(() => {
    if (seen.current === mainKey) return
    seen.current = mainKey
    if (useCollectionPeek.getState().id !== null) useCollectionPeek.getState().close()
  }, [mainKey])

  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(850px,calc(100vh-48px))] w-[min(1240px,calc(100vw-48px))] max-w-none gap-0 overflow-hidden rounded-2xl border-line bg-panel p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{name ?? ''}</DialogTitle>
        <DialogDescription className="sr-only">{COLLECTION_PEEK_TEXT.description}</DialogDescription>
        {id && (
          <CollectionPage
            key={id}
            id={id}
            mode="peek"
            typeId={typeId}
            onExpand={() => {
              close()
              useTabs.getState().open({ kind: 'collection', id }, { via: 'link' })
            }}
            footer={<Stepper />}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
