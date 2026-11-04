// M9 Task 15: there is no custom-label status. `isStatus` is set only on the basic Task
// `status` definition, and no string offers "Use as status"; Object keeps it that way (the back
// end refuses a new `isStatus`). This guard keeps the settings and menu from growing a toggle.
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { PropertyMenu } from './PropertyMenu'
import { PropertySettings } from './PropertySettings'

const PHASE = propertyDef({
  id: 'p-phase',
  key: 'phase',
  name: 'Phase status',
  type: 'label',
  options: { isArray: false, set: [{ id: 'o1', text: 'Planned', color: 'gray', icon: null }] },
})
const PROJECT = typeDef({ id: 'project', name: 'Project', revision: 'r1', propertyDefinitions: [PHASE] })

const STATUS_CONTROL = /status/i

beforeEach(() => {
  resetLinkIndex()
  useLinkIndex.setState({ types: [PROJECT], objects: [], loaded: true })
})

describe('custom label status', () => {
  test('test no status toggle on custom labels', () => {
    const { unmount } = render(<PropertySettings typeId="project" propertyId="p-phase" open onOpenChange={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Property settings')).toBeInTheDocument()
    for (const role of ['switch', 'checkbox', 'menuitemcheckbox', 'button'] as const) {
      expect(within(dialog).queryAllByRole(role, { name: STATUS_CONTROL })).toHaveLength(0)
    }
    expect(within(dialog).queryByText(/as status/i)).toBeNull()
    unmount()

    render(<PropertyMenu type={PROJECT} def={PHASE} onSave={vi.fn()} onEditProperty={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Edit Property' })).toBeInTheDocument()
    expect(screen.queryByText(/as status/i)).toBeNull()
    for (const role of ['switch', 'checkbox', 'menuitemcheckbox', 'menuitem', 'button'] as const) {
      expect(screen.queryAllByRole(role, { name: STATUS_CONTROL })).toHaveLength(0)
    }
  })
})
