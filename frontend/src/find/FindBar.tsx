/** Find in page for the body editor. Stub: Task 8 replaces it and keeps these props. */
import type { RefObject } from 'react'
import type { BodyEditorHandle } from '@/editor/useAutosave'

export interface FindBarProps {
  path: string
  editorRef: RefObject<BodyEditorHandle | null>
}

export function FindBar(_props: FindBarProps) {
  return null
}
