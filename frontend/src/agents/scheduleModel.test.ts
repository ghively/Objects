import { describe, expect, test } from 'vitest'
import { agentSchedule } from '@/test/mockApi'
import { scheduleFieldsOf } from './scheduleModel'

describe('scheduleModel', () => {
  test('test scheduleFieldsOf reads a rule', () => {
    const rule = agentSchedule({
      name: 'Daily digest',
      enabled: false,
      trigger: { kind: 'schedule', repeat: 'every day', time: '18:00', start: '2026-11-06' },
      actions: [{ kind: 'runAgent', agentId: 'assistant', prompt: 'Sum up {date:YYYY-MM-DD}.', model: 'haiku' }],
    })
    expect(scheduleFieldsOf(rule)).toEqual({
      name: 'Daily digest',
      prompt: 'Sum up {date:YYYY-MM-DD}.',
      trigger: { kind: 'schedule', repeat: 'every day', time: '18:00', start: '2026-11-06' },
      model: 'haiku',
      enabled: false,
    })
    expect(scheduleFieldsOf(agentSchedule()).model).toBeNull()
  })
})
