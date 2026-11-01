import { useIsWhiteboard } from '@/whiteboard/isWhiteboard'
import { ObjectView } from './ObjectView'
import { WhiteboardPageLazy } from './WhiteboardLazy'

/** An object opened as a full page in the main panel (a whiteboard opens its canvas, M6; its code loads then). */
export function ObjectPage({ path }: { path: string }) {
  const whiteboard = useIsWhiteboard(path)
  if (whiteboard) return <WhiteboardPageLazy key={path} path={path} mode="page" />
  return <ObjectView key={path} path={path} mode="page" />
}
