import { describe, expect, test } from 'vitest'
import type { AutomationRule } from '@/api/types'
import { agentSchedule, automationRule, automationRun, collection, counterpartDef, propertyDef, typeDef } from '@/test/mockApi'
import {
  RULE_TEXT,
  actionKindsFor,
  agentScheduleInput,
  cleanRule,
  defaultStart,
  isAgentSchedule,
  lastRunText,
  newRuleInput,
  parseTime,
  repeatText,
  ruleInputOf,
  ruleProblem,
  schedulesOf,
  scopeChoices,
  showTime,
  triggerOfKind,
  triggerSummary,
  watchableChoices,
  writableDefs,
} from './ruleModel'

const STATUS = propertyDef({
  id: 'status',
  key: 'status',
  name: 'Status',
  type: 'label',
  options: { set: [{ id: 'done', text: 'Done', color: null, icon: null }, { id: 'doing', text: 'Doing', color: null, icon: null }] },
})
const TASK = typeDef({ id: 'task', name: 'Task', propertyDefinitions: [STATUS] })
const IDEA = typeDef({ id: 'idea', name: 'Idea' })
const READING = collection({ id: 'reading', name: 'Reading list', typeIds: ['task'] })
const ctx = { types: [TASK, IDEA], collections: [READING], twentyFourHour: true }
const NOW = new Date('2026-11-05T12:00:00.000Z')

describe('triggerSummary', () => {
  test('one line per trigger kind', () => {
    expect(triggerSummary({ kind: 'objectCreated', scope: { kind: 'type', id: 'task' } }, ctx)).toBe('When a Task is created')
    expect(triggerSummary({ kind: 'objectCreated', scope: { kind: 'type', id: 'idea' } }, ctx)).toBe('When an Idea is created')
    expect(triggerSummary({ kind: 'objectCreated', scope: { kind: 'collection', id: 'reading' } }, ctx)).toBe(
      'When an object is added to Reading list',
    )
    expect(
      triggerSummary(
        {
          kind: 'propertyChanged',
          scope: { kind: 'type', id: 'task' },
          propertyKey: 'status',
          to: { type: 'filter', propertyId: 'status', option: 'contains', referenceValue: ['done'] },
        },
        ctx,
      ),
    ).toBe('When Status changes to Done')
    expect(
      triggerSummary({ kind: 'propertyChanged', scope: { kind: 'type', id: 'task' }, propertyKey: 'status', to: null }, ctx),
    ).toBe('When Status changes')
    expect(triggerSummary({ kind: 'schedule', repeat: 'every week on mon', time: '09:00', start: '2026-11-09' }, ctx)).toBe(
      'Every week on Monday at 09:00',
    )
    expect(
      triggerSummary({ kind: 'schedule', repeat: 'every day', time: '21:30', start: '2026-11-05' }, { ...ctx, twentyFourHour: false }),
    ).toBe('Every day at 9:30 PM')
    expect(triggerSummary({ kind: 'button', scope: null }, ctx)).toBe('When pressed')
  })

  test('a missing scope shows its id', () => {
    expect(triggerSummary({ kind: 'objectCreated', scope: { kind: 'type', id: 'gone' } }, ctx)).toBe('When a gone is created')
  })
})

describe('times and repeats', () => {
  test.each([
    ['9', '09:00'],
    ['9:30', '09:30'],
    ['21:05', '21:05'],
    ['9:30 pm', '21:30'],
    ['12 am', '00:00'],
    ['12:15 PM', '12:15'],
    ['7p', '19:00'],
    ['24:00', null],
    ['13 pm', null],
    ['9:75', null],
    ['soon', null],
  ])('parseTime(%j) is %j', (text, out) => {
    expect(parseTime(text)).toBe(out)
  })

  test('showTime follows the device clock', () => {
    expect(showTime('09:00', true)).toBe('09:00')
    expect(showTime('00:30', false)).toBe('12:30 AM')
    expect(showTime('13:05', false)).toBe('1:05 PM')
  })

  test('defaultStart is the first day the repeat reaches', () => {
    // 2026-11-05 is a Thursday.
    expect(defaultStart('every week on mon', '2026-11-05')).toBe('2026-11-09')
    expect(defaultStart('every week on thu', '2026-11-05')).toBe('2026-11-05')
    expect(defaultStart('every day', '2026-11-05')).toBe('2026-11-05')
    expect(defaultStart('every weekday', '2026-11-07')).toBe('2026-11-09')
    expect(defaultStart('nonsense', '2026-11-05')).toBe('2026-11-05')
  })

  test('repeatText', () => {
    expect(repeatText('every week on mon, wed', '2026-11-09')).toBe('Every week on Monday and Wednesday')
    expect(repeatText('every 2 days', '2026-11-05')).toBe('Every 2 days')
    expect(repeatText('every weekday', '2026-11-05')).toBe('Every weekday')
    expect(repeatText('every week', '2026-11-05')).toBe('Every week on Thursday')
  })

  test('a new schedule trigger repeats weekly on Monday at 09:00', () => {
    expect(triggerOfKind('schedule', { kind: 'button', scope: null }, null, '2026-11-05')).toEqual({
      kind: 'schedule',
      repeat: 'every week on mon',
      time: '09:00',
      start: '2026-11-09',
    })
    expect(triggerOfKind('objectCreated', { kind: 'button', scope: { kind: 'type', id: 'task' } }, null, '2026-11-05')).toEqual({
      kind: 'objectCreated',
      scope: { kind: 'type', id: 'task' },
    })
  })
})

describe('last run', () => {
  test.each([
    [null, 'Never ran'],
    [automationRun({ ruleId: 'r', at: '2026-11-05T11:55:00.000Z' }), 'Ran 5 minutes ago'],
    [automationRun({ ruleId: 'r', at: '2026-11-05T11:59:50.000Z' }), 'Ran just now'],
    [automationRun({ ruleId: 'r', at: '2026-11-05T10:00:00.000Z', status: 'failed', error: 'Object not found' }), 'Failed 2 hours ago: Object not found'],
    [
      automationRun({
        ruleId: 'r',
        at: '2026-11-04T12:00:00.000Z',
        status: 'failed',
        actions: [{ index: 0, kind: 'addTag', status: 'failed', path: null, detail: 'Tag not found' }],
      }),
      'Failed 1 day ago: Tag not found',
    ],
    [automationRun({ ruleId: 'r', at: '2026-11-02T12:00:00.000Z', status: 'skipped' }), 'Skipped 3 days ago'],
  ])('%#', (run, text) => {
    expect(lastRunText(run, NOW)).toBe(text)
  })
})

describe('before saving', () => {
  const ok = newRuleInput({ name: 'Stamp', actions: [{ kind: 'setProperty', key: 'status', value: ['done'] }] })

  test('ruleProblem names the first missing piece', () => {
    expect(ruleProblem(ok)).toBeNull()
    expect(ruleProblem({ ...ok, name: '  ' })).toBe('Give the automation a name.')
    expect(ruleProblem({ ...ok, actions: [] })).toBe('Add at least one action.')
    expect(ruleProblem({ ...ok, trigger: { kind: 'objectCreated', scope: { kind: 'type', id: '' } } })).toBe('Choose a type or collection.')
    expect(
      ruleProblem({ ...ok, trigger: { kind: 'propertyChanged', scope: { kind: 'type', id: 'task' }, propertyKey: '', to: null } }),
    ).toBe('Choose a property.')
    expect(ruleProblem({ ...ok, trigger: { kind: 'schedule', repeat: 'x', time: '09:00', start: '2026-11-05' }, actions: [{ kind: 'notify', title: '', body: '' }] })).toBe(
      'Choose how often it repeats.',
    )
    expect(ruleProblem({ ...ok, trigger: { kind: 'schedule', repeat: 'every day', time: '9', start: '2026-11-05' } })).toBe('Enter a time.')
    expect(ruleProblem({ ...ok, actions: [{ kind: 'notify', title: '', body: '' }, { kind: 'addTag', tagId: '' }] })).toBe(
      "Action 2 isn't finished.",
    )
  })

  test('cleanRule drops what a schedule cannot have and writes Now as null', () => {
    const sched = cleanRule({
      ...ok,
      name: '  Weekly   review ',
      trigger: { kind: 'schedule', repeat: 'every day', time: '09:00', start: '2026-11-05' },
      conditions: { type: 'filterGroup', operator: 'and', elements: [{ type: 'filter', propertyId: 'status', option: 'contains', referenceValue: ['done'] }] },
      actions: [
        { kind: 'setProperty', key: 'status', value: ['done'] },
        { kind: 'appendToDailyNote', text: 'Review' },
      ],
    })
    expect(sched.name).toBe('Weekly review')
    expect(sched.conditions.elements).toEqual([])
    expect(sched.actions).toEqual([{ kind: 'appendToDailyNote', text: 'Review' }])
    const now = cleanRule({ ...ok, actions: [{ kind: 'setProperty', key: 'due', value: '2026-01-01', now: true }] })
    expect(now.actions[0]).toEqual({ kind: 'setProperty', key: 'due', value: null, now: true })
  })

  test('ruleInputOf drops the API-only fields and keeps unknown ones', () => {
    const rule = { ...automationRule({ id: 'r1', name: 'X' }), futureField: 1 } as AutomationRule
    const input = ruleInputOf(rule)
    expect(input).not.toHaveProperty('id')
    expect(input).not.toHaveProperty('revision')
    expect(input).not.toHaveProperty('lastRun')
    expect(input).toMatchObject({ name: 'X', futureField: 1 })
  })

  test('writableDefs leaves out read-only kinds', () => {
    const t = typeDef({
      id: 't',
      propertyDefinitions: [STATUS, propertyDef({ id: 'b', key: 'b', type: 'button' }), propertyDef({ id: 'c', key: 'createdAt', type: 'entity_createdAt' })],
    })
    expect(writableDefs([t, TASK]).map((d) => d.key)).toEqual(['status'])
  })
})

describe('M21 agent schedules', () => {
  const RESEARCHER = '01JC7ZK3T9Q4M2X8B5N6R1V0WE'

  test('test isAgentSchedule and schedulesOf', () => {
    const weekly = agentSchedule({ id: 'b', name: 'weekly review', actions: [{ kind: 'runAgent', agentId: RESEARCHER, prompt: 'Hi', model: null }] })
    const daily = agentSchedule({ id: 'a', name: 'Daily digest', actions: [{ kind: 'runAgent', agentId: RESEARCHER, prompt: 'Sum up', model: null }] })
    const twin = agentSchedule({ id: 'c', name: 'Daily digest', actions: [{ kind: 'runAgent', agentId: RESEARCHER, prompt: 'Again', model: null }] })
    const other = agentSchedule({ id: 'd', name: 'Other' })
    const plain = automationRule({ id: 'e', trigger: { kind: 'schedule', repeat: 'every day', time: '09:00', start: '2026-11-05' }, actions: [{ kind: 'notify', title: '', body: '' }] })
    expect(isAgentSchedule(weekly)).toBe(true)
    expect(isAgentSchedule(other)).toBe(true)
    expect(isAgentSchedule(plain)).toBe(false)
    expect(other.actions[0]).toMatchObject({ kind: 'runAgent', agentId: 'assistant' })
    expect(other.trigger.kind).toBe('schedule')
    expect(schedulesOf([weekly, plain, twin, other, daily], RESEARCHER).map((r) => r.id)).toEqual(['a', 'c', 'b'])
    expect(schedulesOf([weekly, plain, other], 'assistant').map((r) => r.id)).toEqual(['d'])
  })

  test('test agentScheduleInput builds one runAgent action with empty conditions', () => {
    const trigger = { kind: 'schedule' as const, repeat: 'every week on monday', time: '09:00', start: '2026-11-09' }
    const input = agentScheduleInput(RESEARCHER, 'Weekly review', 'Review {date:YYYY-MM-DD}', trigger, null)
    expect(input).toEqual({
      name: 'Weekly review',
      description: '',
      enabled: true,
      trigger,
      conditions: { type: 'filterGroup', operator: 'and', elements: [] },
      actions: [{ kind: 'runAgent', agentId: RESEARCHER, prompt: 'Review {date:YYYY-MM-DD}', model: null }],
      templateRepeat: null,
    })
    expect(agentScheduleInput(RESEARCHER, 'x', 'y', trigger, 'haiku', false)).toMatchObject({
      enabled: false,
      actions: [{ kind: 'runAgent', model: 'haiku' }],
    })
  })

  test('test runAgent is never offered as an action', () => {
    expect(actionKindsFor('schedule')).not.toContain('runAgent')
    expect(actionKindsFor('button')).not.toContain('runAgent')
    expect(RULE_TEXT.actions.runAgent).toBe('Run an agent')
    expect(RULE_TEXT.runsAgent('Researcher')).toBe('Runs “Researcher”')
    expect(RULE_TEXT.runsMissingAgent).toBe("Runs an agent that isn't listed")
  })
})

describe('M28 counterparts', () => {
  test('test the automation scope leaves out computed other sides (review #3)', () => {
    // The server's automation filter has no counterpart definitions: a condition on one would be
    // dropped and a trigger on it would never fire.
    const runs = counterpartDef({ key: 'runs', name: 'Runs', options: { counterpartOf: [{ typeId: 'application', key: 'runsOn' }] } })
    const host = typeDef({
      id: 'host',
      name: 'Host',
      propertyDefinitions: [propertyDef({ id: 'fqdn', key: 'fqdn', type: 'text' })],
      counterparts: [runs],
    })
    const keys = scopeChoices({ kind: 'type', id: 'host' }, [host], []).map((c) => c.key)
    expect(keys).toContain('fqdn')
    expect(keys).not.toContain('runs')
    expect(watchableChoices(scopeChoices(null, [host], [])).map((c) => c.key)).not.toContain('runs')
  })
})
