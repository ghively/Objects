import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError } from '@/api/client'
import type { TypeDef } from '@/api/types'
import { BASIC_TYPE_INFO } from '@/properties/AddPropertyMenu'
import { propertyDef, typeDef } from '@/test/mockApi'
import { WorkFieldsSection, WORK_FIELDS_TEXT, isWorkType } from './WorkFieldsSection'

const mocked = vi.mocked(api)

const LOCATION = propertyDef({ id: 'p-loc', key: 'location', name: 'Location', type: 'text' })
const STEPS = propertyDef({ id: 'steps', key: 'steps', name: 'Steps', type: 'steps' })
const REQUEST: TypeDef = typeDef({ id: 'request', name: 'Request', pluralName: 'Requests', revision: 'r1', propertyDefinitions: [LOCATION] })

beforeEach(() => {
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
})

describe('WorkFieldsSection', () => {
  test('a custom type adds the work fields and lists the skipped ones', async () => {
    const user = userEvent.setup()
    const saved: TypeDef = { ...REQUEST, revision: 'r2', propertyDefinitions: [LOCATION, STEPS] }
    mocked.addWorkFields.mockResolvedValue({
      type: saved,
      added: ['ticketId', 'steps'],
      skipped: [{ key: 'deskLocation', name: 'Location', reason: 'A property with this name exists' }],
    })
    const onSaved = vi.fn()
    render(<WorkFieldsSection type={REQUEST} onSaved={onSaved} />)
    expect(screen.getByText(WORK_FIELDS_TEXT.explanation)).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Add work fields' })
    expect(button).toBeEnabled()

    await user.click(button)
    await waitFor(() => expect(mocked.addWorkFields).toHaveBeenCalledWith('request', 'r1'))
    expect(onSaved).toHaveBeenCalledWith(saved)
    expect(await screen.findByText('Location: A property with this name exists')).toBeInTheDocument()
  })

  test('a work type shows the button disabled with the reason', () => {
    const work = { ...REQUEST, propertyDefinitions: [LOCATION, STEPS] }
    expect(isWorkType(work)).toBe(true)
    expect(isWorkType(REQUEST)).toBe(false)
    render(<WorkFieldsSection type={work} />)
    expect(screen.getByRole('button', { name: 'Add work fields' })).toBeDisabled()
    expect(screen.getByText('Objects of this type are already work items.')).toBeInTheDocument()
  })

  test('a basic type shows the M2 basic-type text', () => {
    render(<WorkFieldsSection type={{ ...REQUEST, id: 'page', name: 'Page', basic: true }} />)
    expect(screen.getByRole('button', { name: 'Add work fields' })).toBeDisabled()
    expect(screen.getByText(BASIC_TYPE_INFO)).toBeInTheDocument()
  })

  test('a refused add shows the server message', async () => {
    const user = userEvent.setup()
    mocked.addWorkFields.mockRejectedValue(new ApiError(423, 'The type file is read-only.'))
    render(<WorkFieldsSection type={REQUEST} />)
    await user.click(screen.getByRole('button', { name: 'Add work fields' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The type file is read-only.')
  })
})
