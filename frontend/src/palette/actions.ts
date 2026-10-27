/**
 * The action palette's items. Pure: the caller supplies the effects.
 */
import type { Icon, SpaceEntry, TypeDef } from '@/api/types'

/** Capacities' strings, verbatim (`CommandPalette.actions.options.*`, `shortcuts.*.name`). */
export const ACTION_TEXT = {
  createNewEntity: (structureName: string) => `Create ${structureName}`,
  openCalendar: 'Open calendar',
  openToday: 'Open today',
  openGlobalGraph: 'Open global graph',
  openGraphView: 'Open graph view',
  toggleLeftSidebar: 'Toggle left sidebar',
  toggleSidepanel: 'Toggle right sidepanel',
  openEmptyLocalSpaceQuery: 'Open extended search',
  openSettings: 'Open settings',
  openSpace: (spaceName: string) => `Open space "${spaceName}"`,
  toggleFocusMode: 'Toggle focus mode',
} as const

export interface ActionContext {
  types: readonly TypeDef[]
  /** An object is the active target (offers "Open graph view"). */
  hasObjectOpen: boolean
  createObject(typeId: string): void
  openCalendar(): void
  openToday(): void
  openGlobalGraph(): void
  openGraphView(): void
  toggleSidebar(): void
  toggleRightPanel(): void
  /** M8: "Open extended search" (an empty search page). */
  openExtendedSearch?(): void
  /** M8: "Open settings". */
  openSettings?(): void
  /** M8: "Toggle focus mode"; absent while focus mode isn't available. */
  toggleFocusMode?: (() => void) | null
  /** M8: the registered spaces; "Open space …" is offered for each other, present one. */
  spaces?: readonly SpaceEntry[]
  openSpace?(path: string): void
}

export interface Action {
  id: string
  label: string
  /** An Iconify id, or the type's icon for "Create …". */
  icon: string | Icon
  /** The type whose chip to show (create actions). */
  typeId?: string
  run(): void
}

export function buildActions(ctx: ActionContext): Action[] {
  const out: Action[] = []
  const types = [...ctx.types].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  for (const t of types) {
    out.push({
      id: `create:${t.id}`,
      label: ACTION_TEXT.createNewEntity(t.name),
      icon: t.icon,
      typeId: t.id,
      run: () => ctx.createObject(t.id),
    })
  }
  out.push({ id: 'openCalendar', label: ACTION_TEXT.openCalendar, icon: 'ph-calendar-blank', run: ctx.openCalendar })
  out.push({ id: 'openToday', label: ACTION_TEXT.openToday, icon: 'ph-calendar-check', run: ctx.openToday })
  if (ctx.openExtendedSearch) {
    out.push({ id: 'openEmptyLocalSpaceQuery', label: ACTION_TEXT.openEmptyLocalSpaceQuery, icon: 'ph-magnifying-glass', run: ctx.openExtendedSearch })
  }
  out.push({ id: 'openGlobalGraph', label: ACTION_TEXT.openGlobalGraph, icon: 'ph-graph', run: ctx.openGlobalGraph })
  if (ctx.hasObjectOpen) {
    out.push({ id: 'openGraphView', label: ACTION_TEXT.openGraphView, icon: 'ph-graph', run: ctx.openGraphView })
  }
  if (ctx.openSettings) out.push({ id: 'openSettings', label: ACTION_TEXT.openSettings, icon: 'ph-gear', run: ctx.openSettings })
  if (ctx.toggleFocusMode) {
    out.push({ id: 'toggleFocusMode', label: ACTION_TEXT.toggleFocusMode, icon: 'ph-arrows-in', run: ctx.toggleFocusMode })
  }
  out.push({ id: 'toggleLeftSidebar', label: ACTION_TEXT.toggleLeftSidebar, icon: 'ph-sidebar-simple', run: ctx.toggleSidebar })
  out.push({ id: 'toggleSidepanel', label: ACTION_TEXT.toggleSidepanel, icon: 'ph-sidebar-simple', run: ctx.toggleRightPanel })
  const openSpace = ctx.openSpace
  if (openSpace) {
    for (const sp of ctx.spaces ?? []) {
      if (sp.current || sp.missing) continue
      out.push({ id: `openSpace:${sp.path}`, label: ACTION_TEXT.openSpace(sp.name), icon: sp.icon || 'ph-folder', run: () => openSpace(sp.path) })
    }
  }
  return out
}
