/**
 * The whiteboard page, loaded when a board is first opened (as a page or in the peek) rather
 * than with the shell: xyflow, html-to-image and the ink layer are ~550 KB the shell never
 * needs otherwise (audit 2026-11-01 F1). Both importers must use this one lazy module, or a
 * static import elsewhere would pull the code back into the entry.
 */
import { Suspense } from 'react'
import { lazyWithReload } from '@/lib/lazyReload'
import type { WhiteboardPageProps } from '@/whiteboard/WhiteboardPage'

type Props = Omit<WhiteboardPageProps, 'ink'>

const Loaded = lazyWithReload(() =>
  Promise.all([import('@/whiteboard/WhiteboardPage'), import('@/whiteboard/ink')]).then(([page, ink]) => ({
    default: (props: Props) => <page.WhiteboardPage {...props} ink={ink.inkPlugin} />,
  })),
)

/** `WhiteboardPage` with the ink plugin, behind a Suspense boundary (nothing while it loads). */
export function WhiteboardPageLazy(props: Props) {
  return (
    <Suspense fallback={null}>
      <Loaded {...props} />
    </Suspense>
  )
}
