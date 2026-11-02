import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ObjectDetail, SpaceInfo, TypeDef } from '@/api/types'
import { objectDetail, objectSummary, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { ChangeTypeDialog } from './ChangeTypeDialog'
import { ObjectPage } from './ObjectPage'
import { TemplateMarker } from './TemplateMarker'
import { useTypeEditor } from './useTypeEditor'

const mocked = vi.mocked(api)

const PROJECT: TypeDef = typeDef({
  id: 'project',
  name: 'Project',
  pluralName: 'Projects',
  revision: 'r1',
  propertyDefinitions: [propertyDef({ id: 'p-stage', key: 'stage', name: 'Stage' })],
  templates: { ids: ['tpl-1'], defaultTemplateId: null },
})
const TASK: TypeDef = typeDef({
  id: 'task',
  name: 'Task',
  pluralName: 'Tasks',
  basic: true,
  revision: 'r1',
  propertyDefinitions: [
    propertyDef({ id: 'p-status', key: 'status', name: 'Status', type: 'label' }),
    propertyDef({ id: 'p-notes', key: 'notes', name: 'Notes' }),
  ],
})

const PATH = 'Projects/Notes.md'
const TEMPLATE = objectSummary({ path: 'Templates/Projects/Kickoff.md', id: 'tpl-1', type: 'project', template: 'Kickoff' })

let onDisk: ObjectDetail

function detail(version: string, body = 'Body.\n'): ObjectDetail {
  return objectDetail({
    summary: objectSummary({ path: PATH, type: 'project', title: 'Notes' }),
    frontmatter: { type: 'Project', title: 'Notes', stage: 'Idea' },
    body,
    version,
  })
}

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  onDisk = detail('v1')
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PROJECT, TASK] } satisfies SpaceInfo)
  mocked.objects.mockResolvedValue([onDisk.summary])
  mocked.object.mockImplementation(async () => onDisk)
  mocked.templates.mockResolvedValue([TEMPLATE])
  mocked.saveType.mockImplementation(async (t: TypeDef) => ({ type: { ...t, revision: 'r2' }, rewritten: [], skipped: [] }))
})

async function openPage() {
  useTabs.getState().open({ kind: 'type', typeId: 'project' })
  useTabs.getState().open({ kind: 'object', path: PATH })
  const utils = render(<ObjectPage path={PATH} />)
  await screen.findByRole('textbox', { name: 'Title' })
  await waitFor(() => expect(useLinkIndex.getState().types).toHaveLength(2))
  return utils
}

async function openMore(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More' }))
  return screen.findByRole('menu')
}

describe('delete', () => {
  test('test delete confirms, calls deleteObject with baseVersion; Undo Delete restores', async () => {
    const user = userEvent.setup()
    await openPage()
    const menu = await openMore(user)
    const del = within(menu).getByRole('menuitem', { name: /^Delete Object/ })
    await user.click(del)
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Delete this object?')).toBeInTheDocument()
    expect(within(dialog).getByText('Moves it to the Trash.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Delete Object' }))
    await waitFor(() => expect(mocked.deleteObject).toHaveBeenCalledWith(PATH, { baseVersion: 'v1' }))

    const banner = await screen.findByRole('status', { name: 'Deleted content' })
    expect(within(banner).getByRole('button', { name: 'Go back' })).toBeInTheDocument()
    mocked.restore.mockResolvedValueOnce({ paths: [PATH], typeIds: [] })
    await user.click(within(banner).getByRole('button', { name: 'Undo Delete' }))
    await waitFor(() => expect(mocked.restore).toHaveBeenCalledWith('trash-1'))
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Deleted content' })).not.toBeInTheDocument())
  })

  test('Go back returns to the previous target', async () => {
    const user = userEvent.setup()
    await openPage()
    await user.click(within(await openMore(user)).getByRole('menuitem', { name: /^Delete Object/ }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete Object' }))
    const banner = await screen.findByRole('status', { name: 'Deleted content' })
    await user.click(within(banner).getByRole('button', { name: 'Go back' }))
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'type', typeId: 'project' })
  })
})

describe('change type', () => {
  test('test ChangeTypeDialog preselects suggested mapping and requires checkbox when lossy', async () => {
    const user = userEvent.setup()
    mocked.suggestMapping.mockResolvedValue([
      { fromKey: 'stage', toKey: 'status', lossy: true },
      { fromKey: 'owner', toKey: null, lossy: false },
    ])
    mocked.changeType.mockResolvedValue({ path: 'Tasks/Notes.md', version: 'v2', relinked: [], skipped: [] })
    await openPage()
    const menu = await openMore(user)
    // Submenus are driven with plain clicks: jsdom has no layout, so a pointer move closes them.
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Change type' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Task' }))

    const dialog = await screen.findByRole('dialog', { name: 'Change object type?' })
    expect(within(dialog).getByText('Property Mappings')).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Map stage' })).toHaveValue('status'))
    expect(within(dialog).getByRole('combobox', { name: 'Map owner' })).toHaveValue('')
    const go = within(dialog).getByRole('button', { name: 'Change type' })
    expect(go).toBeDisabled()
    await user.click(
      within(dialog).getByRole('checkbox', {
        name: 'I know that with this transformation all or parts of my notes will get lost.',
      }),
    )
    expect(go).toBeEnabled()
    await user.click(go)
    await waitFor(() =>
      expect(mocked.changeType).toHaveBeenCalledWith(PATH, 'task', { stage: 'status', owner: null }, 'v1'),
    )
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Tasks/Notes.md' }))
  })

  test('no checkbox when nothing is lossy', async () => {
    mocked.suggestMapping.mockResolvedValue([{ fromKey: 'stage', toKey: 'notes', lossy: false }])
    render(
      <ChangeTypeDialog open onOpenChange={() => undefined} path={PATH} toType={TASK} prepare={async () => 'v9'} onChanged={() => undefined} />,
    )
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Change type' })).toBeEnabled())
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
  })

  test('a failed change releases what prepare paused', async () => {
    mocked.suggestMapping.mockResolvedValue([{ fromKey: 'stage', toKey: 'notes', lossy: false }])
    const failure = new Error("Status can't become Cores")
    mocked.changeType.mockRejectedValue(failure)
    const onAbort = vi.fn()
    render(
      <ChangeTypeDialog
        open
        onOpenChange={() => undefined}
        path={PATH}
        toType={TASK}
        prepare={async () => 'v9'}
        onAbort={onAbort}
        onChanged={() => undefined}
      />,
    )
    const dialog = await screen.findByRole('dialog')
    const go = within(dialog).getByRole('button', { name: 'Change type' })
    await waitFor(() => expect(go).toBeEnabled())
    fireEvent.click(go)
    await waitFor(() => expect(onAbort).toHaveBeenCalledWith(failure))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Status can't become Cores")
  })
})

describe('templates', () => {
  test('test Use template ▸ Apply calls applyTemplate with current version', async () => {
    const user = userEvent.setup()
    mocked.applyTemplate.mockImplementation(async () => {
      onDisk = detail('v2', 'Body.\n\n## Goals\n')
      return { version: 'v2' }
    })
    await openPage()
    const menu = await openMore(user)
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Use template' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Kickoff' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Apply' }))
    await waitFor(() => expect(mocked.applyTemplate).toHaveBeenCalledWith(PATH, 'tpl-1', 'v1'))
    await waitFor(() => expect(mocked.object).toHaveBeenCalledTimes(2))
  })

  test('test TemplateMarker star sets default via saveType', async () => {
    const user = userEvent.setup()
    useLinkIndex.setState({ types: [PROJECT, TASK], objects: [], loaded: true })
    const onManage = vi.fn()
    function Harness() {
      const editor = useTypeEditor('project')
      const type = useLinkIndex((s) => s.types.find((t) => t.id === 'project'))
      return (
        <TemplateMarker summary={TEMPLATE} type={type} editor={editor} onRename={() => undefined} onManage={onManage} />
      )
    }
    render(<Harness />)
    const marker = screen.getByRole('region', { name: 'Template' })
    expect(within(marker).getByRole('textbox', { name: 'Template Name' })).toHaveValue('Kickoff')
    expect(within(marker).getByText('Templates prefill new objects.')).toBeInTheDocument()
    await user.click(within(marker).getByRole('button', { name: 'Make default' }))
    await waitFor(() => expect(mocked.saveType).toHaveBeenCalledTimes(1))
    const [saved, opts] = mocked.saveType.mock.calls[0]
    expect(saved.templates).toEqual({ ids: ['tpl-1'], defaultTemplateId: 'tpl-1' })
    expect(opts).toEqual({ baseRevision: 'r1' })
    await waitFor(() => expect(within(marker).getByRole('button', { name: 'Make default' })).toHaveAttribute('aria-pressed', 'true'))
    await user.click(within(marker).getByRole('button', { name: 'Manage' }))
    expect(onManage).toHaveBeenCalled()
  })

  test('a template object shows the marker, and renaming it writes the template key', async () => {
    const user = userEvent.setup()
    onDisk = objectDetail({
      summary: TEMPLATE,
      frontmatter: { type: 'Project', template: 'Kickoff' },
      version: 't1',
    })
    mocked.object.mockImplementation(async () => onDisk)
    render(<ObjectPage path={TEMPLATE.path} />)
    const input = await screen.findByRole('textbox', { name: 'Template Name' })
    await user.clear(input)
    await user.type(input, 'Launch{Enter}')
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalled())
    expect(mocked.updateProperties.mock.calls[0].slice(0, 3)).toEqual([TEMPLATE.path, { template: 'Launch' }, 't1'])
  })
})
