/**
 * What the canvas needs from the rest of the app, behind one injectable object (tests pass
 * fakes). The defaults use the real modules (imports only; nothing pre-existing is edited).
 */
import { createContext, useContext } from 'react'
import { api } from '@/api/client'
import type { ObjectSummary, Row } from '@/api/types'
import { openObject as openWithMods } from '@/create/createAndOpen'
import { resolveLink } from '@/links/linkIndex'
import { usePeek } from '@/nav/tabs'
import { useDeleteRequest } from '@/object/DeleteObjectDialog'
import { wikilinkFor } from './linkText'

export interface WhiteboardHost {
  /** Double-click on an embedded object: the peek; with Ctrl/Cmd, a new tab. */
  openObject(path: string, e: { ctrlKey?: boolean; metaKey?: boolean }): void
  /** The wikilink an embedded object stores for `path`. */
  linkFor(path: string): string
  resolve(link: string, from?: string): Promise<string | null>
  rows(paths: string[]): Promise<Row[]>
  /** Ask the view showing `path` (this board) to confirm a delete. */
  requestDelete(path: string, mode: 'page' | 'peek'): void
  /** Create an object of a type ("New object"); resolves with its path. */
  createObject(typeId: string): Promise<string>
  objects(): Promise<ObjectSummary[]>
  /** M8: copy a file into `Attachments/` (never overwrites); resolves with its space path. */
  uploadAttachment?(file: File): Promise<{ path: string }>
  /** M8: the same-origin URL of a space file (`GET /api/file`). */
  fileUrl?(path: string): string
  /** M8: open a space file with the OS default app (double-click on a media node). */
  openAttachment?(path: string): Promise<unknown>
}

export const defaultHost: WhiteboardHost = {
  openObject(path, e) {
    if (e.ctrlKey || e.metaKey) openWithMods(path, { ctrlKey: e.ctrlKey, metaKey: e.metaKey })
    else usePeek.getState().peek(path)
  },
  linkFor(path) {
    return wikilinkFor(path)
  },
  resolve(link, from) {
    return resolveLink(link, from)
  },
  rows(paths) {
    return api.rows({ paths })
  },
  requestDelete(path, mode) {
    useDeleteRequest.getState().requestDelete(path, mode)
  },
  createObject(typeId) {
    return api.createObject(typeId).then((r) => r.path)
  },
  objects() {
    return api.objects()
  },
  uploadAttachment(file) {
    return api.uploadAttachment(file, file.name)
  },
  fileUrl(path) {
    return api.fileUrl(path)
  },
  openAttachment(path) {
    return api.openAttachment(path)
  },
}

/** The host's media helpers, falling back to the real API for a host that doesn't give them. */
export function mediaHost(host: WhiteboardHost): Required<Pick<WhiteboardHost, 'uploadAttachment' | 'fileUrl' | 'openAttachment'>> {
  return {
    uploadAttachment: (f) => (host.uploadAttachment ?? defaultHost.uploadAttachment!)(f),
    fileUrl: (p) => (host.fileUrl ?? defaultHost.fileUrl!)(p),
    openAttachment: (p) => (host.openAttachment ?? defaultHost.openAttachment!)(p),
  }
}

export const WhiteboardHostContext = createContext<WhiteboardHost>(defaultHost)

/** The host of the board being rendered (nodes use it to resolve and open objects). */
export function useWhiteboardHost(): WhiteboardHost {
  return useContext(WhiteboardHostContext)
}
