// M31 item 15b: Integrations "Show developer information": ids, keys and paths in the UI.
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { objectSummary, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { PropertyPanel } from '@/object/PropertyPanel'
import { PropertySettings } from '@/properties/PropertySettings'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { DEV_INFO_TEXT, DevInfo } from './DevInfo'

const writeText = vi.fn(() => Promise.resolve())

function devOn(on: boolean) {
  useSettings.setState({ settings: { ...settingsDefaults, showDeveloperInfo: on }, revision: 'r0', loaded: true })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetLinkIndex()
  devOn(false)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

describe('DevInfo', () => {
  test('test nothing shows while the setting is off', () => {
    render(<DevInfo rows={[{ label: 'Note id', value: 'abc' }]} />)
    expect(screen.queryByRole('region', { name: DEV_INFO_TEXT.heading })).toBeNull()
    act(() => devOn(true))
    const box = screen.getByRole('region', { name: DEV_INFO_TEXT.heading })
    expect(within(box).getByText('Note id')).toBeInTheDocument()
    expect(within(box).getByText('abc')).toBeInTheDocument()
  })

  test('test a value copies with its button, and an empty one reads None', async () => {
    devOn(true)
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(
      <DevInfo
        rows={[
          { label: 'File path', value: 'Pages/A.md' },
          { label: 'Note id', value: null },
        ]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Copy File path' }))
    expect(writeText).toHaveBeenCalledWith('Pages/A.md')
    expect(screen.getByText(DEV_INFO_TEXT.none)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy Note id' })).toBeNull()
  })

  test("test the properties panel shows the object's id and file path", () => {
    const type = typeDef({ id: 'page', name: 'Page', propertyDefinitions: [] })
    const summary = objectSummary({ path: 'Pages/Alpha.md', id: 'obj-123', type: 'page' })
    const { rerender } = render(<PropertyPanel type={type} frontmatter={{}} summary={summary} />)
    expect(screen.queryByText('obj-123')).toBeNull()
    act(() => devOn(true))
    rerender(<PropertyPanel type={type} frontmatter={{}} summary={summary} />)
    const box = screen.getByRole('region', { name: DEV_INFO_TEXT.heading })
    expect(within(box).getByText(DEV_INFO_TEXT.objectId)).toBeInTheDocument()
    expect(within(box).getByText('obj-123')).toBeInTheDocument()
    expect(within(box).getByText('Pages/Alpha.md')).toBeInTheDocument()
  })

  test("test property settings show the property's key and id", () => {
    devOn(true)
    const def = propertyDef({ id: 'prop-status', key: 'status', name: 'Status', type: 'text' })
    useLinkIndex.setState({ types: [typeDef({ id: 'project', name: 'Project', propertyDefinitions: [def] })] })
    render(<PropertySettings typeId="project" propertyId="prop-status" open onOpenChange={() => undefined} />)
    const box = screen.getByRole('region', { name: DEV_INFO_TEXT.heading })
    expect(within(box).getByText(DEV_INFO_TEXT.propertyKey)).toBeInTheDocument()
    expect(within(box).getByText('status')).toBeInTheDocument()
    expect(within(box).getByText('prop-status')).toBeInTheDocument()
  })
})
