import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Icon } from '@/components/Icon'
import { stemOf, summaryOf, useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { useIsWhiteboard } from '@/whiteboard/isWhiteboard'
import { ObjectView } from './ObjectView'
import { WhiteboardPageLazy } from './WhiteboardLazy'

function Pager() {
  const { index, list, next, prev } = usePeek()
  if (list.length < 2) return null
  return (
    <div className="flex items-center gap-1 rounded-xl border border-line bg-raised-2 py-1 pr-1 pl-3 text-[15px]">
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

/** The object "peek": a large modal over the current page, with a pager through the list it came from. */
export function ObjectPeek() {
  const path = usePeek((s) => s.path)
  const close = usePeek((s) => s.close)
  useLinkIndex((s) => s.revision)
  const whiteboard = useIsWhiteboard(path)
  const title = path ? (summaryOf(path)?.title ?? stemOf(path)) : ''

  return (
    <Dialog open={path !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(850px,calc(100vh-48px))] w-[min(1240px,calc(100vw-48px))] max-w-none gap-0 overflow-hidden rounded-2xl border-line bg-panel p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">Object preview</DialogDescription>
        {path &&
          (whiteboard ? (
            <WhiteboardPageLazy
              key={path}
              path={path}
              mode="peek"
              onExpand={() => {
                useTabs.getState().open({ kind: 'object', path }, { via: 'link' })
                close()
              }}
              onDismiss={close}
              footer={<Pager />}
            />
          ) : (
            <ObjectView
              key={path}
              path={path}
              mode="peek"
              onExpand={() => {
                useTabs.getState().open({ kind: 'object', path }, { via: 'link' })
                close()
              }}
              onDismiss={close}
              footer={<Pager />}
            />
          ))}
      </DialogContent>
    </Dialog>
  )
}
