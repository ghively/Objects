// M23 Task 7: Make it smaller's splitter and the item reference.
import { describe, expect, test } from 'vitest'
import { WORK_TEXT } from '../workText'
import { itemRef, splitStep } from './splitStep'

describe('split step', () => {
  test('splits on ; , and, then, (', () => {
    expect(splitStep('Check the spooler; restart it and test print')).toEqual([
      'Check the spooler',
      'Restart it',
      'Test print',
    ])
    expect(splitStep('Unplug the printer then wait (about a minute)')).toEqual([
      'Unplug the printer',
      'Wait',
      'About a minute',
    ])
    // pieces of 3 characters or fewer are dropped
    expect(splitStep('one, two, three, four, five, six')).toEqual(['Three', 'Four', 'Five'])
    expect(splitStep('aaaa, bbbb, cccc, dddd, eeee')).toEqual(['Aaaa', 'Bbbb', 'Cccc', 'Dddd'])
  })

  test('fewer than two pieces get the framing lines', () => {
    expect(splitStep('Reboot')).toEqual([WORK_TEXT.splitGet, 'Reboot', WORK_TEXT.splitWrite])
    expect(splitStep('Reboot')).toEqual(['Get what you need for this step', 'Reboot', 'Write down what you found'])
    expect(splitStep('Reboot it, ok')).toEqual([WORK_TEXT.splitGet, 'Reboot it, ok', WORK_TEXT.splitWrite])
  })

  test('itemRef is the ticket id, else the title', () => {
    expect(itemRef({ ticket: null, title: 'Order toner' })).toBe('Order toner')
    const ticket = {
      id: 'INC0012345', system: 'ServiceNow' as const, url: null, deskStatus: null, deskPriority: null,
      requester: null, group: null, location: null, opened: null, updated: null, resolved: null,
    }
    expect(itemRef({ ticket, title: 'Printer jams on line 3' })).toBe('INC0012345')
  })
})
