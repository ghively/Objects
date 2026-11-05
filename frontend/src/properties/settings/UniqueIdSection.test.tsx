import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { PropertyDef, PropertyOptions, PropertyType, TypeDef } from '@/api/types'
import { propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

vi.mock('@/links/linkIndex', async (orig) => {
  const mod = await orig<typeof import('@/links/linkIndex')>()
  return { ...mod, invalidateLinkIndex: vi.fn(async () => undefined) }
})

import { api, RevisionConflictError } from '@/api/client'
import { invalidateLinkIndex, resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { PropertySettings } from '../PropertySettings'
import { UNIQUE_ID_TEXT } from './texts'

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })

function taskType(options: PropertyOptions, kind: PropertyType = 'uniqueId'): TypeDef {
  const ID = propertyDef({ id: 'p-id', key: 'ref', name: 'Ref', type: kind, options })
  return typeDef({ id: 'task', name: 'Ticket', revision: 'r1', propertyDefinitions: [TITLE, ID] })
}

function savedDef(call = 0): PropertyDef | undefined {
  const t: TypeDef = vi.mocked(api.saveType).mock.calls[call][0]
  return t.propertyDefinitions.find((d) => d.id === 'p-id')
}

function open(options: PropertyOptions, kind?: PropertyType) {
  useLinkIndex.setState({ types: [taskType(options, kind)], objects: [], loaded: true })
  render(<PropertySettings typeId="task" propertyId="p-id" open onOpenChange={vi.fn()} />)
}

const prefixBox = () => screen.getByRole('textbox', { name: UNIQUE_ID_TEXT.prefix }) as HTMLInputElement

beforeEach(() => {
  vi.mocked(api.saveType).mockClear()
  vi.mocked(api.numberExistingObjects).mockReset()
  vi.mocked(invalidateLinkIndex).mockClear()
  resetLinkIndex()
})

describe('UniqueIdSection', () => {
  test('shows the prefix and the next ID', () => {
    open({ prefix: 'TASK-', nextNumber: 12 })
    expect(prefixBox().value).toBe('TASK-')
    expect(document.querySelector('[data-next-id]')?.textContent).toBe('TASK-12')
  })

  test('a valid prefix is saved on blur', async () => {
    const user = userEvent.setup()
    open({ prefix: '', nextNumber: 1 })
    await user.type(prefixBox(), 'BUG_2-')
    expect(api.saveType).not.toHaveBeenCalled()
    await user.tab()
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedDef()?.options).toEqual({ prefix: 'BUG_2-', nextNumber: 1 })
  })

  test('Enter saves the prefix once', async () => {
    const user = userEvent.setup()
    open({ prefix: '', nextNumber: 1 })
    await user.type(prefixBox(), 'T{Enter}')
    await user.tab()
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedDef()?.options.prefix).toBe('T')
  })

  test.each([
    ['a space', 'TASK 1'],
    ['a symbol', 'TASK#'],
    ['21 characters', 'ABCDEFGHIJKLMNOPQRSTU'],
  ])('a prefix with %s is refused inline and not saved', async (_what, value) => {
    const user = userEvent.setup()
    open({ prefix: '', nextNumber: 1 })
    await user.type(prefixBox(), value)
    expect(screen.getByText(UNIQUE_ID_TEXT.prefixInvalid)).toBeInTheDocument()
    expect(prefixBox()).toHaveAttribute('aria-invalid', 'true')
    await user.tab()
    expect(api.saveType).not.toHaveBeenCalled()
  })

  test('Escape puts the saved prefix back', async () => {
    const user = userEvent.setup()
    open({ prefix: 'A-', nextNumber: 1 })
    await user.type(prefixBox(), 'xx{Escape}')
    expect(prefixBox().value).toBe('A-')
  })

  test('"Number existing objects" numbers them and reports how many', async () => {
    const user = userEvent.setup()
    const answered = taskType({ prefix: 'TASK-', nextNumber: 15 })
    vi.mocked(api.numberExistingObjects).mockResolvedValue({
      type: { ...answered, revision: 'r2' },
      numbered: 3,
      rewritten: ['Tickets/a.md', 'Tickets/b.md', 'Tickets/c.md'],
      skipped: [],
    })
    open({ prefix: 'TASK-', nextNumber: 12 })
    await user.click(screen.getByRole('button', { name: UNIQUE_ID_TEXT.numberExisting }))
    expect(await screen.findByText('Numbered 3 objects')).toBeInTheDocument()
    expect(api.numberExistingObjects).toHaveBeenCalledWith('task', 'p-id', 'r1')
    // The answered type is adopted: the next ID moves on.
    expect(useLinkIndex.getState().types.find((t) => t.id === 'task')?.revision).toBe('r2')
    expect(document.querySelector('[data-next-id]')?.textContent).toBe('TASK-15')
  })

  test('skipped files are reported', async () => {
    const user = userEvent.setup()
    vi.mocked(api.numberExistingObjects).mockResolvedValue({
      type: taskType({ prefix: '', nextNumber: 2 }),
      numbered: 1,
      rewritten: ['Tickets/a.md'],
      skipped: ['Tickets/b.md'],
    })
    open({ prefix: '', nextNumber: 1 })
    await user.click(screen.getByRole('button', { name: UNIQUE_ID_TEXT.numberExisting }))
    expect(await screen.findByText('Numbered 1 object (1 file could not be changed)')).toBeInTheDocument()
  })

  test('a revision conflict reloads the index and says so', async () => {
    const user = userEvent.setup()
    vi.mocked(api.numberExistingObjects).mockRejectedValue(new RevisionConflictError('r9'))
    open({ prefix: '', nextNumber: 1 })
    await user.click(screen.getByRole('button', { name: UNIQUE_ID_TEXT.numberExisting }))
    expect(await screen.findByText(UNIQUE_ID_TEXT.conflict)).toBeInTheDocument()
    expect(invalidateLinkIndex).toHaveBeenCalled()
  })

  test('another failure shows its message', async () => {
    const user = userEvent.setup()
    vi.mocked(api.numberExistingObjects).mockRejectedValue(new Error('Not an ID property'))
    open({ prefix: '', nextNumber: 1 })
    await user.click(screen.getByRole('button', { name: UNIQUE_ID_TEXT.numberExisting }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not an ID property')
    expect(screen.getByRole('button', { name: UNIQUE_ID_TEXT.numberExisting })).toBeEnabled()
  })

  test('an ID cannot change its property type', () => {
    open({ prefix: '', nextNumber: 1 })
    expect(screen.getByText('This property type cannot be changed.')).toBeInTheDocument()
  })
})

describe('Email, Phone and Files', () => {
  test.each(['email', 'phone', 'files'] as const)('%s shows only the common settings', (kind) => {
    open(kind === 'files' ? { isArray: true } : {}, kind)
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Ref')
    expect(screen.getByRole('textbox', { name: 'Description' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Visibility' })).toBeInTheDocument()
    expect(screen.getByText('This property type cannot be changed.')).toBeInTheDocument()
    for (const heading of ['Format', 'Formula', 'Rollup', 'ID', 'Linked object type', 'Label set']) {
      expect(screen.queryByRole('region', { name: heading })).toBeNull()
    }
  })
})
