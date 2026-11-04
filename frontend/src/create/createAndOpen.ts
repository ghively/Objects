/**
 * Create an object and open it where the modifier keys say:
 * - plain: the current tab (a Task opens in the peek, unless "Always open as full page" is on),
 * - Ctrl or Meta: a new tab,
 * - Alt+Shift: the peek,
 * - Shift: the side panel (area 1).
 */
import { api } from '@/api/client'
import type { CreatedFile } from '@/api/types'
import { invalidateLinkIndex, typeOf } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { useSettings } from '@/settings/useSettings'

export interface OpenMods {
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  /** M7: how the open was asked for (a link, or sidebar/nav); breadcrumbs use it (Task 14). */
  via?: 'link' | 'nav'
}

export type OpenMode = 'current' | 'newTab' | 'peek' | 'sidepanel'

/**
 * Tasks open in the peek by default; with "Always open as full page"
 * they open as a page.
 */
function opensInPeek(typeId: string | null | undefined): boolean {
  if (!typeId) return false
  if (useSettings.getState().settings.alwaysOpenAsFullPage) return false
  const t = typeOf(typeId)
  return (t?.name ?? typeId).toLowerCase() === 'task'
}

export function openModeFor(mods: OpenMods = {}, typeId?: string | null): OpenMode {
  if (mods.ctrlKey || mods.metaKey) return 'newTab'
  if (mods.shiftKey) return mods.altKey ? 'peek' : 'sidepanel'
  return opensInPeek(typeId) ? 'peek' : 'current'
}

/** Open an existing object as `mods` say. */
export function openObject(path: string, mods: OpenMods = {}, typeId?: string | null): OpenMode {
  const mode = openModeFor(mods, typeId)
  if (mode === 'peek') usePeek.getState().peek(path)
  else if (mode === 'sidepanel') useTabs.getState().openInSidepanel({ kind: 'object', path })
  else useTabs.getState().open({ kind: 'object', path }, { newTab: mode === 'newTab', via: mods.via })
  return mode
}

/** Create an object of `typeId` (`templateId`: an id, `null` for the default, `"none"`) and open it. */
export async function createAndOpen(
  typeId: string,
  opts: { title?: string; templateId?: string | null; values?: Record<string, unknown> } = {},
  mods: OpenMods = {},
): Promise<CreatedFile> {
  const req: { title?: string; templateId?: string | null; values?: Record<string, unknown> } = {}
  if (opts.title !== undefined) req.title = opts.title
  if (opts.templateId !== undefined) req.templateId = opts.templateId
  if (opts.values !== undefined && Object.keys(opts.values).length > 0) req.values = opts.values
  const res = await api.createObject(typeId, req)
  openObject(res.path, mods, typeId)
  void invalidateLinkIndex()
  return res
}
