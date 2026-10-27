import { describe, expect, test, vi } from 'vitest'
import { typeDef } from '@/test/mockApi'
import { buildActions, type ActionContext } from './actions'

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
})
