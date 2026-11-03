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

describe('buildActions', () => {
  test('lists a create action per type by name, then the fixed actions', () => {
    expect(buildActions(ctx()).map((a) => a.label)).toEqual([
      'Create Page',
      'Create Person',
      'Open calendar',
      'Open today',
      'Open global graph',
      'Toggle left sidebar',
      'Toggle right sidepanel',
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
      'Create Page',
      'Create Person',
      'Open calendar',
      'Open today',
      'Open extended search',
      'Open global graph',
      'Open graph view',
      'Open settings',
      'Toggle focus mode',
      'Toggle left sidebar',
      'Toggle right sidepanel',
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
    expect(labels('create')).toEqual(['Create Page', 'Create Person'])
    expect(labels('cr pe')).toEqual(['Create Person'])
    expect(labels('cal')).toEqual(['Open calendar'])
    expect(labels('Toggle')).toEqual(['Toggle left sidebar', 'Toggle right sidepanel'])
    expect(labels('graph')).toEqual(['Open global graph'])
    expect(labels('alendar')).toEqual(['Open calendar'])
    expect(labels('zzz')).toEqual([])
  })
})
