import { useIsWhiteboard } from '@/whiteboard/isWhiteboard'
import { ObjectView } from './ObjectView'
import { WhiteboardPageLazy } from './WhiteboardLazy'

/**
 * An object opened as a full page in the main panel (a whiteboard opens its canvas, M6; its code
 * loads then). M23: `workHeader` (the item panel) shows a work item's work header above the title;
 * a whiteboard ignores it.
 */
export function ObjectPage({ path, workHeader }: { path: string; workHeader?: boolean }) {
  const whiteboard = useIsWhiteboard(path)
  if (whiteboard) return <WhiteboardPageLazy key={path} path={path} mode="page" />
  return <ObjectView key={path} path={path} mode="page" workHeader={workHeader} />
}
