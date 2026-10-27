import { inkPlugin } from '@/whiteboard/ink'
import { useIsWhiteboard } from '@/whiteboard/isWhiteboard'
import { WhiteboardPage } from '@/whiteboard/WhiteboardPage'
import { ObjectView } from './ObjectView'

/** An object opened as a full page in the main panel (a whiteboard opens its canvas, M6). */
export function ObjectPage({ path }: { path: string }) {
  const whiteboard = useIsWhiteboard(path)
  if (whiteboard) return <WhiteboardPage key={path} path={path} mode="page" ink={inkPlugin} />
  return <ObjectView key={path} path={path} mode="page" />
}
