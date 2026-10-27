/**
 * The action palette's items. Pure: the caller supplies the effects.
 */
import type { Icon, TypeDef } from '@/api/types'

/** Object's strings, verbatim (`CommandPalette.actions.options.*`, `shortcuts.*.name`). */
export const ACTION_TEXT = {
  createNewEntity: (structureName: string) => `Create ${structureName}`,
  openCalendar: 'Open calendar',
  openToday: 'Open today',
  openGlobalGraph: 'Open global graph',
  openGraphView: 'Open graph view',
  toggleLeftSidebar: 'Toggle left sidebar',
  toggleSidepanel: 'Toggle right sidepanel',
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
  out.push({ id: 'openGlobalGraph', label: ACTION_TEXT.openGlobalGraph, icon: 'ph-graph', run: ctx.openGlobalGraph })
  if (ctx.hasObjectOpen) {
    out.push({ id: 'openGraphView', label: ACTION_TEXT.openGraphView, icon: 'ph-graph', run: ctx.openGraphView })
  }
  out.push({ id: 'toggleLeftSidebar', label: ACTION_TEXT.toggleLeftSidebar, icon: 'ph-sidebar-simple', run: ctx.toggleSidebar })
  out.push({ id: 'toggleSidepanel', label: ACTION_TEXT.toggleSidepanel, icon: 'ph-sidebar-simple', run: ctx.toggleRightPanel })
  return out
}
