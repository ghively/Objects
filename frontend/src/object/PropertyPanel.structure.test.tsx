// "Hide object type settings outside of settings" (EditorSettings.hideStructureSettings).
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { objectSummary, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { PropertyPanel } from './PropertyPanel'

const TYPE = typeDef({
  id: 'project',
  name: 'Project',
  propertyDefinitions: [propertyDef({ id: 'p-note', key: 'note', name: 'Note', type: 'text' })],
})

afterEach(() => useSettings.setState({ settings: settingsDefaults }))

function panel() {
  return render(
    <PropertyPanel
      type={TYPE}
      frontmatter={{ note: 'hi' }}
      summary={objectSummary({ path: 'Projects/X.md', type: 'project' })}
      onChange={vi.fn()}
      onTypeChange={vi.fn()}
    />,
  )
}

describe('PropertyPanel with type settings hidden', () => {
  test('test property labels lose their menu and Add Property is marked', () => {
    useSettings.setState({ settings: { ...settingsDefaults, hideStructureSettings: true } })
    panel()
    expect(screen.queryByRole('button', { name: 'Note property menu' })).not.toBeInTheDocument()
    expect(screen.getByText('Note')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Property' })).toHaveAttribute('data-structure-setting')
  })

  test('test property labels keep their menu by default', () => {
    panel()
    expect(screen.getByRole('button', { name: 'Note property menu' })).toBeInTheDocument()
  })
})
