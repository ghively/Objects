import type { Editor as TiptapEditor } from '@tiptap/core'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, ObjectDetail, SpaceInfo, StepValue, TypeDef, WorkStepRequest } from '@/api/types'
import { objectDetail, objectSummary, propertyDef, typeDef, workItem, workStep, workWriteResult } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/editor/media/upload', async (orig) => ({ ...(await orig()), showToast: vi.fn() }))
vi.mock('@/find/FindBar', () => ({ FindBar: () => null }))
vi.mock('@/references/ReferencesSection', () => ({ ReferencesSection: () => null }))

import { api, StepChangedError } from '@/api/client'
import { serializeBody } from '@/editor/document'
import { showToast } from '@/editor/media/upload'
import { resetLinkIndex } from '@/links/linkIndex'
import { useFind } from '@/find/useFind'
import { usePeek, useTabs } from '@/nav/tabs'
import { ObjectPage } from './ObjectPage'

const mocked = vi.mocked(api)

const TICKET_ID = propertyDef({ id: 'ticketId', key: 'ticketId', name: 'Ticket ID', type: 'text', visibility: 'hideWhenEmpty' })
const STEPS = propertyDef({ id: 'steps', key: 'steps', name: 'Steps', type: 'steps', visibility: 'alwaysShow' })
const WORK: TypeDef = typeDef({
  id: 'request',
  name: 'Request',
  pluralName: 'Requests',
  revision: 'r1',
  propertyDefinitions: [TICKET_ID, STEPS],
})

const PATH = 'Requests/Printer jams on line 3.md'
const ORIGINAL = 'The printer jams.\n'
const STEP: StepValue = {
  id: 'q4m2xa',
  rev: '0123456789ab',
  kind: 'do',
  state: 'open',
  text: 'Check the printer cable',
  notBefore: null,
  answer: null,
  result: null,
  addedAt: null,
  approvedAt: null,
  doneAt: null,
  declinedAt: null,
}

function detail(body: string, version: string): ObjectDetail {
  return objectDetail({
    summary: objectSummary({ path: PATH, type: 'request', title: 'Printer jams on line 3' }),
    frontmatter: { type: 'Request', title: 'Printer jams on line 3', ticketId: 'INC0012345', steps: [STEP] },
    body,
    version,
  })
}

let listeners: ((e: ChangeEvent) => void)[] = []

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  useFind.getState().close()
  listeners = []
  vi.mocked(showToast).mockReset()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [WORK] } satisfies SpaceInfo)
  mocked.objects.mockResolvedValue([detail(ORIGINAL, 'v1').summary])
  mocked.object.mockImplementation(async () => detail(ORIGINAL, 'v1'))
  mocked.resolve.mockResolvedValue(null)
  mocked.saveBody.mockImplementation(async () => ({ version: 'v3' }))
  mocked.workItem.mockImplementation(async (p: string) => workItem({ path: p, steps: [workStep()] }))
  mocked.onChange.mockImplementation((cb: (e: ChangeEvent) => void) => {
    listeners.push(cb)
    return () => {
      listeners = listeners.filter((l) => l !== cb)
    }
  })
})

function pmEditor(container: HTMLElement): TiptapEditor {
  const dom = container.querySelector('.ProseMirror') as (HTMLElement & { editor?: TiptapEditor }) | null
  if (!dom?.editor) throw new Error('editor not mounted')
  return dom.editor
}

async function openPage() {
  const utils = render(<ObjectPage path={PATH} />)
  await screen.findByRole('heading', { level: 1, name: 'Printer jams on line 3' })
  const editor = await waitFor(() => pmEditor(utils.container))
  await waitFor(() => expect(serializeBody(editor)).toBe(ORIGINAL))
  await waitFor(() => expect(listeners.length).toBeGreaterThan(0))
  // The type has loaded: the step list is writable.
  await screen.findByRole('button', { name: 'Edit step 1' })
  return { ...utils, editor }
}

/** Type `text` at the end of the first paragraph. */
function typeInBody(editor: TiptapEditor, text: string): string {
  let pos = -1
  editor.state.doc.forEach((node, offset) => {
    if (pos < 0 && node.type.name === 'paragraph') pos = offset + node.nodeSize - 1
  })
  act(() => {
    editor.commands.insertContentAt(pos, text)
  })
  return serializeBody(editor)
}

async function markStepDone(user: ReturnType<typeof userEvent.setup>) {
  const row = screen.getAllByRole('listitem').find((li) => within(li).queryByRole('button', { name: 'Edit step 1' }))!
  await user.click(within(row).getByRole('button', { name: /^State:/ }))
  await user.click(within(row).getByRole('button', { name: 'Mark done' }))
}

describe('work writes on the object page', () => {
  test('a step action saves the body first, then loads the returned body and version', async () => {
    const user = userEvent.setup()
    const { editor } = await openPage()
    const mine = typeInBody(editor, ' Mine.')
    const returned = `${mine}\n## Activity\n\n- 2026-11-05 10:00 Gene marked done step 1 "Check the printer cable"\n`
    const done = { ...STEP, state: 'done' as const, doneAt: '2026-11-05T10:00:00.000Z', rev: 'fedcba987654' }
    mocked.workStep.mockImplementation(async (req: WorkStepRequest) =>
      workWriteResult({
        version: 'v5',
        body: returned,
        frontmatter: { steps: [done] },
        item: workItem({ path: req.path, version: 'v5', fields: { steps: [done] }, steps: [workStep({ ...done, current: false })] }),
      }),
    )

    await markStepDone(user)
    await waitFor(() => expect(mocked.workStep).toHaveBeenCalledTimes(1))
    // One body save, before the step action.
    expect(mocked.saveBody).toHaveBeenCalledTimes(1)
    expect(mocked.saveBody).toHaveBeenCalledWith(PATH, mine, 'v1')
    expect(mocked.saveBody.mock.invocationCallOrder[0]).toBeLessThan(mocked.workStep.mock.invocationCallOrder[0])
    expect(mocked.workStep).toHaveBeenCalledWith(
      expect.objectContaining({ path: PATH, stepId: 'q4m2xa', stepRev: '0123456789ab', action: 'done' }),
    )
    // The editor shows the returned body (the new Activity line).
    await waitFor(() => expect(serializeBody(editor)).toBe(returned))
    expect(screen.getByRole('button', { name: 'State: Done' })).toBeInTheDocument()

    // The next body save is based on the returned version: no 409.
    const more = typeInBody(editor, '!')
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledTimes(2), { timeout: 3000 })
    expect(mocked.saveBody).toHaveBeenLastCalledWith(PATH, more, 'v5')
    expect(screen.queryByRole('dialog', { name: /changed on disk/i })).not.toBeInTheDocument()
  }, 15000)

  test('a step that changed meanwhile shows the message and changes nothing', async () => {
    const user = userEvent.setup()
    const { editor } = await openPage()
    mocked.workStep.mockRejectedValue(new StepChangedError('This step changed. Look again.', 'v9', null))

    await markStepDone(user)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('This step changed. Look again.'))
    expect(mocked.workStep).toHaveBeenCalledTimes(1)
    expect(serializeBody(editor)).toBe(ORIGINAL)
    expect(screen.queryByRole('dialog', { name: /changed on disk/i })).not.toBeInTheDocument()
    expect(mocked.saveBody).not.toHaveBeenCalled()
    // Nothing is blocked: a body edit still saves on the version we had.
    const mine = typeInBody(editor, ' Mine.')
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledWith(PATH, mine, 'v1'), { timeout: 3000 })
  }, 15000)

  test('a ticket shows the Resolution note under the properties, collapsed', async () => {
    const user = userEvent.setup()
    await openPage()
    mocked.workItem.mockResolvedValue(
      workItem({ path: PATH, resolution: { workNotes: 'Work notes: INC0012345 Printer jams on line 3', closeNotes: 'Close notes: INC0012345', gaps: 0 } }),
    )
    const toggle = screen.getByRole('button', { name: 'Resolution note' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(await screen.findByText('Work notes: INC0012345 Printer jams on line 3')).toBeInTheDocument()
  })
})
