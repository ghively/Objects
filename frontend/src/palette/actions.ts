/**
 * The action palette's items. Pure: the caller supplies the effects.
 *
 * Fix pass W17: the three everyday commands go by the names the rest of the app gives them, "New
 * note", "New task" and "Today's note" (they were "Create Note", "Create <the Task type's name>"
 * and "Pop out today's daily note", so "new" found no command). Each runs what its key runs
 * (`newNote`, `newTask`, `openTodaysNote`), and the names they had still find them (`terms`).
 */
import type { Icon, SpaceEntry, TypeDef } from '@/api/types'
import { typeLabel } from '@/lib/typeLabel'
import { NEW_NOTE, TODAYS_NOTE } from '@/lib/words'
import { nameMatches, pageType } from './searchOptions'

/** The action rows' labels. */
export const ACTION_TEXT = {
  createNewEntity: (typeName: string) => `Create ${typeName}`,
  /** W17: the Note type's row and the Task type's row (was "Create Task", the Tasks page's "New task"). */
  newNote: NEW_NOTE,
  newTask: 'New task',
  openCalendar: 'Open calendar',
  openToday: 'Open today',
  /** W17: was "Pop out today's daily note" (still a search term; it opens the same way). */
  openTodaysNote: TODAYS_NOTE,
  openTodaysNoteWas: "Pop out today's daily note",
  openAllNotes: 'Open all notes',
  openGlobalGraph: 'Open global graph',
  openGraphView: 'Open graph view',
  toggleLeftSidebar: 'Toggle left sidebar',
  toggleSidepanel: 'Toggle right side panel',
  openEmptyLocalSpaceQuery: 'Open extended search',
  openSettings: 'Open settings',
  openSpaceHistory: 'Open space history',
  openSpace: (spaceName: string) => `Open space "${spaceName}"`,
  toggleFocusMode: 'Toggle focus mode',
} as const

export interface ActionContext {
  types: readonly TypeDef[]
  /** A note is the active target (offers "Open graph view"). */
  hasObjectOpen: boolean
  createObject(typeId: string): void
  /** W17: what the new-note key runs (a Note); without it "New note" creates one as any type's row does. */
  newNote?(): void
  /** W17: what the new-task key runs; without it "New task" creates one as any type's row does. */
  newTask?(): void
  openCalendar(): void
  openToday(): void
  /** 2026-11-09: today's daily note in the peek (created when missing). */
  openTodaysNote?(): void
  /** The all-notes view (M32: the sidebar's "All notes" entry opens it too). */
  openAllNotes?(): void
  openGlobalGraph(): void
  openGraphView(): void
  toggleSidebar(): void
  toggleRightPanel(): void
  /** M8: "Open extended search" (an empty search page). */
  openExtendedSearch?(): void
  /** M8: "Open settings". */
  openSettings?(): void
  /** 2026-11-08: the space's git history (version control). */
  openSpaceHistory?(): void
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
  /** Other names the row is found by (W17: the name it had, the type's own name). Never shown. */
  terms?: readonly string[]
  run(): void
}

/** The basic Task type among `types` (by flag and name, else the id: `tasks/useTaskRows.findTaskType`'s rule). */
function taskType(types: readonly TypeDef[]): TypeDef | undefined {
  return types.find((t) => t.basic && t.name.toLowerCase() === 'task') ?? types.find((t) => t.id === 'task')
}

export function buildActions(ctx: ActionContext): Action[] {
  const out: Action[] = []
  // W17: "New note" and "New task" first, by the names the sidebar, Home and the Tasks page use.
  const note = pageType(ctx.types)
  const task = taskType(ctx.types)
  if (note) {
    const run = ctx.newNote ?? (() => ctx.createObject(note.id))
    out.push({ id: 'newNote', label: ACTION_TEXT.newNote, icon: note.icon, typeId: note.id, terms: [ACTION_TEXT.createNewEntity(typeLabel(note))], run })
  }
  if (task && task !== note) {
    const run = ctx.newTask ?? (() => ctx.createObject(task.id))
    out.push({ id: 'newTask', label: ACTION_TEXT.newTask, icon: task.icon, typeId: task.id, terms: [ACTION_TEXT.createNewEntity(typeLabel(task)), 'Create task'], run })
  }
  // Every other type, by the name the screen shows.
  const types = ctx.types
    .filter((t) => t !== note && t !== task)
    .sort((a, b) => typeLabel(a).localeCompare(typeLabel(b), undefined, { sensitivity: 'base' }))
  for (const t of types) {
    out.push({
      id: `create:${t.id}`,
      label: ACTION_TEXT.createNewEntity(typeLabel(t)),
      icon: t.icon,
      typeId: t.id,
      run: () => ctx.createObject(t.id),
    })
  }
  out.push({ id: 'openCalendar', label: ACTION_TEXT.openCalendar, icon: 'ph-calendar-blank', run: ctx.openCalendar })
  out.push({ id: 'openToday', label: ACTION_TEXT.openToday, icon: 'ph-calendar-check', run: ctx.openToday })
  if (ctx.openTodaysNote) {
    out.push({ id: 'openTodaysNote', label: ACTION_TEXT.openTodaysNote, icon: 'ph-notebook', terms: [ACTION_TEXT.openTodaysNoteWas], run: ctx.openTodaysNote })
  }
  if (ctx.openAllNotes) out.push({ id: 'openAllNotes', label: ACTION_TEXT.openAllNotes, icon: 'ph-note', run: ctx.openAllNotes })
  if (ctx.openExtendedSearch) {
    out.push({ id: 'openEmptyLocalSpaceQuery', label: ACTION_TEXT.openEmptyLocalSpaceQuery, icon: 'ph-magnifying-glass', run: ctx.openExtendedSearch })
  }
  out.push({ id: 'openGlobalGraph', label: ACTION_TEXT.openGlobalGraph, icon: 'ph-graph', run: ctx.openGlobalGraph })
  if (ctx.hasObjectOpen) {
    out.push({ id: 'openGraphView', label: ACTION_TEXT.openGraphView, icon: 'ph-graph', run: ctx.openGraphView })
  }
  if (ctx.openSettings) out.push({ id: 'openSettings', label: ACTION_TEXT.openSettings, icon: 'ph-gear', run: ctx.openSettings })
  if (ctx.openSpaceHistory)
    out.push({ id: 'openSpaceHistory', label: ACTION_TEXT.openSpaceHistory, icon: 'ph-clock-counter-clockwise', run: ctx.openSpaceHistory })
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

/**
 * The actions whose label (or one of its other names, `terms`) matches `query` (the palette's
 * name match), in list order. None for an empty query: the palette shows the recent notes then
 * (our choice).
 */
export function matchActions(actions: readonly Action[], query: string): Action[] {
  const q = query.trim()
  if (!q) return []
  return actions.filter((a) => nameMatches(q, a.label) || (a.terms ?? []).some((t) => nameMatches(q, t)))
}
