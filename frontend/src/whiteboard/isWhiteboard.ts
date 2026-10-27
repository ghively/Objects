/**
 * Whether an object is a whiteboard (an object of the basic Whiteboard type), so the page and
 * the peek render `WhiteboardPage` instead of `ObjectView` (M6 Task 13).
 */
import type { TypeDef } from '@/api/types'
import { summaryOf, typeOf, useLinkIndex } from '@/links/linkIndex'

/** Capacities' `RootWhiteboard` as a type of ours: the basic type named "Whiteboard". */
export const WHITEBOARD_TYPE_NAME = 'Whiteboard'

export function isWhiteboardType(t: Pick<TypeDef, 'name' | 'basic'> | null | undefined): boolean {
  return !!t && t.basic && t.name.toLowerCase() === WHITEBOARD_TYPE_NAME.toLowerCase()
}

/** True when `path` is a known object of the Whiteboard type. */
export function isWhiteboardPath(path: string): boolean {
  return isWhiteboardType(typeOf(summaryOf(path)?.type))
}

/** `isWhiteboardPath`, re-read whenever the link index changes. */
export function useIsWhiteboard(path: string | null): boolean {
  useLinkIndex((s) => s.revision)
  useLinkIndex((s) => s.objects)
  return path !== null && isWhiteboardPath(path)
}
