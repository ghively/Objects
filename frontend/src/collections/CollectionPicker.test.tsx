import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { collection, propertyDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { CollectionsCell } from '@/properties/cells/SystemFieldCell'
import { CollectionPicker } from './CollectionPicker'

const mocked = vi.mocked(api)

const TOOLING = collection({ id: 'tooling', name: 'Tooling', typeIds: ['server'] })
const READING = collection({ id: 'reading', name: 'Reading', typeIds: ['page'] })

beforeEach(() => {
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.collections.mockResolvedValue([TOOLING, READING])
  mocked.queries.mockResolvedValue([])
  mocked.onChange.mockReturnValue(() => undefined)
})

describe('CollectionPicker', () => {
  test('test picker lists only collections of the type and creates on Create', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    mocked.createCollection.mockImplementation(async (name: string, typeIds: string[]) =>
      collection({ id: 'new', name, typeIds, revision: 'r1' }),
    )
    render(<CollectionPicker value={[]} typeId="server" onChange={onChange} />)
    expect(await screen.findByRole('option', { name: /Tooling/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Reading/ })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search collections or create one')).toBeInTheDocument()
    expect(screen.getByText('No Collection')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox'), 'Gear')
    await user.click(await screen.findByRole('option', { name: "Create 'Gear'" }))
    expect(mocked.createCollection).toHaveBeenCalledWith('Gear', ['server'])
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(['Gear']))
  })

  test('selecting and unselecting reports names and the summary counts them', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<CollectionPicker value={[]} typeId="server" onChange={onChange} />)
    await user.click(await screen.findByRole('option', { name: /Tooling/ }))
    expect(onChange).toHaveBeenCalledWith(['Tooling'])
    rerender(<CollectionPicker value={['Tooling']} typeId="server" onChange={onChange} />)
    expect(screen.getByText('1 Collection')).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /Tooling/ }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })
})

describe('CollectionsCell', () => {
  test('test CollectionsCell writes names through onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const def = propertyDef({ id: 'collections', key: 'collections', name: 'Collections', type: 'entity_collections' })
    render(<CollectionsCell def={def} value={['Other']} typeId="server" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Edit Collections' }))
    await user.click(await screen.findByRole('option', { name: /Tooling/ }))
    expect(onChange).toHaveBeenCalledWith(['Other', 'Tooling'])
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Remove Other' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  test('a read-only cell shows chips and no editor', () => {
    const def = propertyDef({ id: 'collections', key: 'collections', name: 'Collections', type: 'entity_collections' })
    render(<CollectionsCell def={def} value={['Tooling']} readOnly typeId="server" onChange={() => undefined} />)
    expect(screen.getByText('Tooling')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Collections' })).not.toBeInTheDocument()
  })
})
