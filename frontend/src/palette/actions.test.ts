import { describe, expect, test, vi } from 'vitest'
import { spaceEntry, typeDef } from '@/test/mockApi'
import { buildActions, matchActions, type ActionContext } from './actions'

function ctx(partial: Partial<ActionContext> = {}): ActionContext {
  return {
    types: [typeDef({ id: 'person', name: 'Person' }), typeDef({ id: 'page', name: 'Page' })],
    hasObjectOpen: false,
    createObject: vi.fn(),
    openCalendar: vi.fn(),
    openToday: vi.fn(),
    openGlobalGraph: vi.fn(),
    openGraphView: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleRightPanel: vi.fn(),
    ...partial,
  }
}

// Fix pass W17: the palette says "Find notes and commands", so the three everyday commands are
// there under the names the rest of the app uses, found by "new", "note", "task" and "today".
describe('the everyday commands (W17)', () => {
  const TASK = typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks', basic: true })
  const everyday = (partial: Partial<ActionContext> = {}) =>
    ctx({
      types: [typeDef({ id: 'person', name: 'Person' }), TASK, typeDef({ id: 'page', name: 'Page', basic: true })],
      newNote: vi.fn(),
      newTask: vi.fn(),
      openTodaysNote: vi.fn(),
      openAllNotes: vi.fn(),
      ...partial,
    })
  const found = (q: string, c = everyday()) => matchActions(buildActions(c), q).map((a) => a.label)

  test('test the commands open with New note and New task, then one Create per other type, and Today\'s note', () => {
    expect(buildActions(everyday()).map((a) => a.label)).toEqual([
      'New note',
      'New task',
      'Create Person',
      'Open calendar',
      'Open today',
      "Today's note",
      'Open all notes',
      'Open global graph',
      'Toggle left sidebar',
      'Toggle right side panel',
    ])
  })

  test('test "new", "note", "task" and "today" each find their command', () => {
    expect(found('new')).toEqual(['New note', 'New task'])
    expect(found('note')).toEqual(['New note', "Today's note", 'Open all notes'])
    expect(found('task')).toEqual(['New task'])
    expect(found('today')).toEqual(['Open today', "Today's note"])
    expect(found('new no')).toEqual(['New note'])
    expect(found("today's note")).toEqual(["Today's note"])
  })

  test('test the names they had still find them', () => {
    expect(found('create')).toEqual(['New note', 'New task', 'Create Person'])
    expect(found('create note')).toEqual(['New note'])
    expect(found('create task')).toEqual(['New task'])
    expect(found('pop out today')).toEqual(["Today's note"])
    expect(found('daily')).toEqual(["Today's note"])
  })

  test('test each runs what its key runs, not a plain create of the type', () => {
    const c = everyday()
    const byId = Object.fromEntries(buildActions(c).map((a) => [a.id, a]))
    byId.newNote.run()
    byId.newTask.run()
    byId.openTodaysNote.run()
    expect(c.newNote).toHaveBeenCalledTimes(1)
    expect(c.newTask).toHaveBeenCalledTimes(1)
    expect(c.openTodaysNote).toHaveBeenCalledTimes(1)
    expect(c.createObject).not.toHaveBeenCalled()
    // The type chip beside each is still its type's.
    expect(byId.newNote.typeId).toBe('page')
    expect(byId.newTask.typeId).toBe('task')
  })

  test('test a Task type under another name still reads "New task", and its own name finds it', () => {
    const c = everyday({ types: [typeDef({ id: 'task', name: 'Task / Action', pluralName: 'Tasks', basic: true }), typeDef({ id: 'page', name: 'Page', basic: true })] })
    expect(buildActions(c).map((a) => a.label).slice(0, 2)).toEqual(['New note', 'New task'])
    expect(buildActions(c).map((a) => a.label)).not.toContain('Create Task / Action')
    expect(found('action', c)).toEqual(['New task'])
  })

  test('test no New task without a Task type (a space that hides Tasks), and a caller with no key handlers creates the type', () => {
    const noTask = everyday({ types: [typeDef({ id: 'page', name: 'Page', basic: true })] })
    expect(found('task', noTask)).toEqual([])
    expect(found('new', noTask)).toEqual(['New note'])
    const plain = everyday({ newNote: undefined, newTask: undefined })
    const byId = Object.fromEntries(buildActions(plain).map((a) => [a.id, a]))
    byId.newNote.run()
    byId.newTask.run()
    expect(vi.mocked(plain.createObject).mock.calls).toEqual([['page'], ['task']])
  })
})

describe('buildActions', () => {
  test('lists New note, a create action per other type by name, then the fixed actions', () => {
    expect(buildActions(ctx()).map((a) => a.label)).toEqual([
      'New note',
      'Create Person',
      'Open calendar',
      'Open today',
      'Open global graph',
      'Toggle left sidebar',
      'Toggle right side panel',
    ])
  })

  test('open graph view only with an object open', () => {
    const labels = buildActions(ctx({ hasObjectOpen: true })).map((a) => a.label)
    expect(labels).toContain('Open graph view')
    expect(labels.indexOf('Open graph view')).toBe(labels.indexOf('Open global graph') + 1)
  })

  test('each action runs its effect', () => {
    const c = ctx({ hasObjectOpen: true })
    const byId = Object.fromEntries(buildActions(c).map((a) => [a.id, a]))
    byId['create:person'].run()
    expect(c.createObject).toHaveBeenCalledWith('person')
    byId.openCalendar.run()
    byId.openToday.run()
    byId.openGlobalGraph.run()
    byId.openGraphView.run()
    byId.toggleLeftSidebar.run()
    byId.toggleSidepanel.run()
    for (const f of [c.openCalendar, c.openToday, c.openGlobalGraph, c.openGraphView, c.toggleSidebar, c.toggleRightPanel]) {
      expect(f).toHaveBeenCalledTimes(1)
    }
  })

  test('m8 actions: extended search, settings, focus mode and other spaces', () => {
    const c = ctx({
      hasObjectOpen: true,
      openExtendedSearch: vi.fn(),
      openSettings: vi.fn(),
      toggleFocusMode: vi.fn(),
      openSpace: vi.fn(),
      spaces: [
        spaceEntry({ path: '/s/Home', name: 'Home', current: true }),
        spaceEntry({ path: '/s/Work', name: 'Work' }),
        spaceEntry({ path: '/s/Old', name: 'Old', missing: true }),
      ],
    })
    const actions = buildActions(c)
    expect(actions.map((a) => a.label)).toEqual([
      'New note',
      'Create Person',
      'Open calendar',
      'Open today',
      'Open extended search',
      'Open global graph',
      'Open graph view',
      'Open settings',
      'Toggle focus mode',
      'Toggle left sidebar',
      'Toggle right side panel',
      'Open space "Work"',
    ])
    const byId = Object.fromEntries(actions.map((a) => [a.id, a]))
    byId.openEmptyLocalSpaceQuery.run()
    byId.openSettings.run()
    byId.toggleFocusMode.run()
    byId['openSpace:/s/Work'].run()
    expect(c.openExtendedSearch).toHaveBeenCalledTimes(1)
    expect(c.openSettings).toHaveBeenCalledTimes(1)
    expect(c.toggleFocusMode).toHaveBeenCalledTimes(1)
    expect(c.openSpace).toHaveBeenCalledWith('/s/Work')
  })

  test('no focus mode action without a toggle', () => {
    expect(buildActions(ctx({ toggleFocusMode: null })).some((a) => a.id === 'toggleFocusMode')).toBe(false)
  })
})

describe('matchActions', () => {
  const labels = (q: string) => matchActions(buildActions(ctx()), q).map((a) => a.label)

  test('an empty query lists none (the palette shows recents then)', () => {
    expect(labels('')).toEqual([])
    expect(labels('   ')).toEqual([])
  })

  test('matches a label by prefix, word prefixes or a substring, in list order', () => {
    expect(labels('create')).toEqual(['New note', 'Create Person'])
    expect(labels('cr pe')).toEqual(['Create Person'])
    expect(labels('cal')).toEqual(['Open calendar'])
    expect(labels('Toggle')).toEqual(['Toggle left sidebar', 'Toggle right side panel'])
    expect(labels('graph')).toEqual(['Open global graph'])
    expect(labels('alendar')).toEqual(['Open calendar'])
    expect(labels('zzz')).toEqual([])
  })
})
