import type { Editor as TiptapEditor } from '@tiptap/core'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, ObjectDetail, SpaceInfo, TypeDef, WorkItem, WorkStepRequest } from '@/api/types'
import {
  agentStatus,
  objectDetail,
  objectSummary,
  propertyDef,
  typeDef,
  workItem,
  workStep,
  workWriteResult,
} from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/editor/media/upload', async (orig) => ({ ...(await orig()), showToast: vi.fn() }))
vi.mock('@/find/FindBar', () => ({ FindBar: () => null }))
vi.mock('@/references/ReferencesSection', () => ({ ReferencesSection: () => null }))

import { api } from '@/api/client'
import { serializeBody } from '@/editor/document'
import { showToast } from '@/editor/media/upload'
import { resetLinkIndex } from '@/links/linkIndex'
import { useFind } from '@/find/useFind'
import { usePeek, useTabs } from '@/nav/tabs'
import { ObjectPage } from '@/object/ObjectPage'
import { stepAction } from '../state/workActions'

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
const PAGE: TypeDef = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', revision: 'r1', propertyDefinitions: [] })

const PATH = 'Requests/Printer jams on line 3.md'
const PLAIN = 'Pages/Plain page.md'
const ORIGINAL = 'The printer jams.\n'

const Q = workStep({
  id: 'q4m2xa',
  rev: 'acd90259e325',
  kind: 'question',
  state: 'done',
  text: 'Which tray jams most often?',
  answer: 'Tray 2, mostly in the morning',
  doneAt: '2026-11-04T15:10:00.000Z',
  n: 1,
  current: false,
  actions: ['reopen'],
})
const A = workStep({
  id: 'r8k1pd',
  rev: '5d8a71fff518',
  kind: 'approve',
  state: 'open',
  text: 'Restart the print spooler on PRN-TEST-01',
  n: 2,
  current: true,
  actions: ['approve', 'decline'],
})
const G = workStep({
  id: 't2n7vc',
  rev: '5347440b9471',
  kind: 'agent',
  state: 'open',
  text: 'Run 20 test prints and check the spooler log',
  n: 3,
  current: false,
  actions: [],
})

const NEWEST = { at: '2026-11-04 15:10', text: 'Gene answered step 1', raw: '2026-11-04 15:10 Gene answered step 1' }
const OLDER = { at: '2026-11-04 14:02', text: 'Gene added 3 steps', raw: '2026-11-04 14:02 Gene added 3 steps' }

function printer(over: Partial<WorkItem> = {}): WorkItem {
  return workItem({
    path: PATH,
    title: 'Printer jams on line 3',
    typeId: 'request',
    version: 'v1',
    ticket: {
      id: 'INC0012345',
      system: 'ServiceNow',
      url: 'https://desk.example.test/INC0012345',
      deskStatus: 'In progress',
      deskPriority: 'Medium',
      requester: 'Sam Sample',
      group: 'Print Support',
      location: 'Plant A',
      opened: '2026-11-03',
      updated: '2026-11-04',
      resolved: null,
    },
    area: 'Printers',
    confidence: 'Medium',
    confidenceReason: 'Seen twice on tray 2',
    blockedOn: '[[Pat Example]] to unlock the cabinet',
    steps: [Q, A, G],
    turn: 'approve',
    findings: 'Tray 2 jams after the spooler restarts.',
    hypothesis: 'The print spooler on PRN-TEST-01 crashes when tray 2 jams.',
    verified: ['Tray 2 jams'],
    assumed: ['The spooler crashes'],
    toRaiseConfidence: ['Read the spooler log'],
    floorItems: [{ id: 'f1', rev: 'a1b2c3d4e5f6', place: 'Line 3', what: 'Spare tray', collected: null, found: null }],
    resolution: { workNotes: 'Work notes: INC0012345 Printer jams on line 3', closeNotes: 'Close notes: INC0012345', gaps: 0 },
    activity: [NEWEST, OLDER],
    ...over,
  })
}

function detail(body: string, version: string): ObjectDetail {
  return objectDetail({
    summary: objectSummary({ path: PATH, type: 'request', title: 'Printer jams on line 3' }),
    frontmatter: { type: 'Request', title: 'Printer jams on line 3', ticketId: 'INC0012345', steps: [Q, A, G] },
    body,
    version,
  })
}

let listeners: ((e: ChangeEvent) => void)[] = []
let item: WorkItem

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  useFind.getState().close()
  listeners = []
  item = printer()
  vi.mocked(showToast).mockReset()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [WORK, PAGE] } satisfies SpaceInfo)
  mocked.objects.mockResolvedValue([detail(ORIGINAL, 'v1').summary])
  mocked.object.mockImplementation(async (p: string) =>
    p === PLAIN
      ? objectDetail({
          summary: objectSummary({ path: PLAIN, type: 'page', title: 'Plain page' }),
          frontmatter: { type: 'Page', title: 'Plain page' },
          body: 'Just text.\n',
          version: 'p1',
        })
      : detail(ORIGINAL, 'v1'),
  )
  mocked.resolve.mockResolvedValue(null)
  mocked.saveBody.mockImplementation(async () => ({ version: 'v3' }))
  mocked.workItem.mockImplementation(async () => item)
  mocked.workAgent.mockResolvedValue(agentStatus())
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
  const utils = render(<ObjectPage path={PATH} workHeader />)
  await screen.findByRole('heading', { level: 1, name: 'Printer jams on line 3' })
  const editor = await waitFor(() => pmEditor(utils.container))
  await waitFor(() => expect(serializeBody(editor)).toBe(ORIGINAL))
  await waitFor(() => expect(listeners.length).toBeGreaterThan(0))
  const header = await screen.findByRole('region', { name: 'Work' })
  // The type has loaded: the step lists are writable.
  await within(header).findByRole('button', { name: 'Edit step 1' })
  return { ...utils, editor, header }
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

function approvedResult(body: string, version: string) {
  const approved = { ...A, state: 'approved' as const, rev: 'fedcba987654', approvedAt: '2026-11-05T10:00:00.000Z' }
  const after = printer({
    version,
    turn: 'agent',
    steps: [Q, workStep({ ...approved, actions: ['reopen'] }), G],
    activity: [{ at: '2026-11-05 10:00', text: 'Gene approved step 2', raw: '2026-11-05 10:00 Gene approved step 2' }, NEWEST, OLDER],
  })
  return workWriteResult({ version, body, frontmatter: { steps: [Q, approved, G] }, item: after })
}

describe('the work header', () => {
  // Fix pass H: a step list with an entry that can't be read refuses every step write (422), so the
  // header offers no step actions and says why.
  test('an unreadable step list offers no step actions and shows the problem', async () => {
    item = printer({ stepsUnreadable: true, problems: ['Step 3 has an unknown kind "maybe".'] })
    render(<ObjectPage path={PATH} workHeader />)
    const header = await screen.findByRole('region', { name: 'Work' })
    expect(await within(header).findByRole('alert')).toHaveTextContent('Step 3 has an unknown kind "maybe".')
    await within(header).findByText(Q.text)
    expect(within(header).queryByRole('button', { name: /Mark done|Answer|Approve|Edit step/ })).toBeNull()
  })

  test('the header shows the work parts in order', async () => {
    const user = userEvent.setup()
    const { header } = await openPage()
    const parts = [...header.querySelectorAll('[data-work-part]')].map((e) => e.getAttribute('data-work-part'))
    expect(parts).toEqual([
      'chips',
      'openTicket',
      'current',
      'session',
      'waitingOn',
      'findings',
      'hypothesis',
      'evidence',
      'steps',
      'floor',
      'note',
      'resolution',
      'activity',
    ])
    const h = within(header)
    expect(h.getByText('INC0012345')).toBeInTheDocument()
    expect(h.getByText('Printers')).toBeInTheDocument()
    expect(h.getByRole('link', { name: 'Open ticket' })).toHaveAttribute('href', 'https://desk.example.test/INC0012345')
    expect(h.getByRole('link', { name: 'Open ticket' })).toHaveAttribute('target', '_blank')
    // The current step with its two-press Approve.
    expect(h.getByText('Restart the print spooler on PRN-TEST-01', { selector: 'p' })).toBeInTheDocument()
    await user.click(h.getByRole('button', { name: 'Approve' }))
    expect(h.getByRole('button', { name: 'Press again to approve' })).toBeInTheDocument()
    expect(mocked.workStep).not.toHaveBeenCalled()
    expect(h.getByRole('button', { name: 'Start together' })).toBeInTheDocument()
    expect(h.getByRole('button', { name: 'Make it smaller' })).toBeInTheDocument()
    expect(h.getByRole('region', { name: 'Waiting on' })).toHaveTextContent('[[Pat Example]] to unlock the cabinet')
    expect(h.getByRole('region', { name: 'Findings' })).toHaveTextContent('Tray 2 jams after the spooler restarts.')
    expect(h.getByRole('region', { name: 'Hypothesis' })).toHaveTextContent('crashes when tray 2 jams')
    expect(h.getByRole('meter', { name: 'Confidence' })).toHaveAttribute('data-filled', '2')
    expect(h.getByRole('region', { name: 'Verified' })).toHaveTextContent('Tray 2 jams')
    expect(h.getByRole('region', { name: 'Assumed' })).toHaveTextContent('The spooler crashes')
    expect(h.getByRole('region', { name: 'To raise confidence' })).toHaveTextContent('Read the spooler log')
    expect(h.getByRole('checkbox', { name: 'Line 3: Spare tray' })).not.toBeChecked()
    expect(h.getByRole('button', { name: 'Add note' })).toBeInTheDocument()
    expect(h.getByRole('button', { name: 'Ask the agent' })).toBeInTheDocument()
    expect(await h.findByText('The agent loop comes with M24.')).toBeInTheDocument()
    // The resolution note's two copy-ready blocks.
    expect(h.getAllByRole('button', { name: 'Copy' })).toHaveLength(2)
    expect(h.getByText('Work notes: INC0012345 Printer jams on line 3')).toBeInTheDocument()
    // Activity, newest first.
    const lines = within(h.getByRole('list', { name: 'Activity' })).getAllByRole('listitem')
    expect(lines.map((l) => l.textContent)).toEqual([`${NEWEST.at}${NEWEST.text}`, `${OLDER.at}${OLDER.text}`])
    // No Close for an approve turn; M22's under-panel Resolution note isn't shown a second time.
    expect(h.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resolution note' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Work notes: INC0012345 Printer jams on line 3')).toHaveLength(1)
  }, 15000)

  test('a plain page shows no header', async () => {
    render(<ObjectPage path={PLAIN} workHeader />)
    await screen.findByRole('heading', { level: 1, name: 'Plain page' })
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0))
    expect(screen.queryByRole('region', { name: 'Work' })).not.toBeInTheDocument()
  })

  test('without workHeader a ticket keeps the under-panel Resolution note and no header', async () => {
    render(<ObjectPage path={PATH} />)
    await screen.findByRole('heading', { level: 1, name: 'Printer jams on line 3' })
    expect(await screen.findByRole('button', { name: 'Resolution note' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Work' })).not.toBeInTheDocument()
  })

  test('an action with a pending body edit saves the body first and shows the new Activity line', async () => {
    const user = userEvent.setup()
    const { editor, header } = await openPage()
    const mine = typeInBody(editor, ' Mine.')
    const returned = `${mine}\n## Activity\n\n- 2026-11-05 10:00 Gene approved step 2 "Restart the print spooler on PRN-TEST-01"\n`
    mocked.workStep.mockImplementation(async () => approvedResult(returned, 'v5'))

    const h = within(header)
    await user.click(h.getByRole('button', { name: 'Approve' }))
    await user.click(h.getByRole('button', { name: 'Press again to approve' }))
    await waitFor(() => expect(mocked.workStep).toHaveBeenCalledTimes(1))
    expect(mocked.saveBody).toHaveBeenCalledTimes(1)
    expect(mocked.saveBody).toHaveBeenCalledWith(PATH, mine, 'v1')
    expect(mocked.saveBody.mock.invocationCallOrder[0]).toBeLessThan(mocked.workStep.mock.invocationCallOrder[0])
    expect(mocked.workStep).toHaveBeenCalledWith(
      expect.objectContaining({ path: PATH, stepId: 'r8k1pd', stepRev: '5d8a71fff518', action: 'approve' }),
    )
    // The editor shows the returned body; the header adopts the returned item.
    await waitFor(() => expect(serializeBody(editor)).toBe(returned))
    expect(await h.findByText('Gene approved step 2')).toBeInTheDocument()
    expect(h.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()

    // The next body save is based on the returned version: no 409.
    const more = typeInBody(editor, '!')
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledTimes(2), { timeout: 3000 })
    expect(mocked.saveBody).toHaveBeenLastCalledWith(PATH, more, 'v5')
    expect(screen.queryByRole('dialog', { name: /changed on disk/i })).not.toBeInTheDocument()
  }, 15000)

  test('an action from the Now card reloads an open page of the item', async () => {
    const { editor, header } = await openPage()
    const returned = `${ORIGINAL}\n## Activity\n\n- 2026-11-05 10:00 Gene approved step 2 "Restart the print spooler on PRN-TEST-01"\n`
    const res = approvedResult(returned, 'v5')
    mocked.workStep.mockImplementation(async (req: WorkStepRequest) => {
      // What the real client does: announce the write to this window's listeners.
      mocked.object.mockImplementation(async () => detail(returned, 'v5'))
      item = res.item
      setTimeout(() => {
        for (const l of [...listeners]) l({ kind: 'changed', path: req.path, version: 'v5', origin: 'me' })
      }, 0)
      return res
    })

    let ok = false
    await act(async () => {
      ok = await stepAction({ item: { path: PATH }, step: A, action: 'approve' })
    })
    expect(ok).toBe(true)
    expect(mocked.saveBody).not.toHaveBeenCalled()
    await waitFor(() => expect(serializeBody(editor)).toBe(returned))
    expect(await within(header).findByText('Gene approved step 2')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /changed on disk/i })).not.toBeInTheDocument()
  }, 15000)

  test('ask the agent sends a request note', async () => {
    const user = userEvent.setup()
    const { header } = await openPage()
    const h = within(header)
    mocked.workNote.mockImplementation(async (p: string) => workWriteResult({ item: printer({ path: p, version: 'v2' }) }))
    // Empty text sends nothing.
    await user.click(h.getByRole('button', { name: 'Ask the agent' }))
    expect(mocked.workNote).not.toHaveBeenCalled()
    await user.type(h.getByRole('textbox', { name: 'Add note' }), '  Check tray 2 again  ')
    await user.click(h.getByRole('button', { name: 'Ask the agent' }))
    await waitFor(() => expect(mocked.workNote).toHaveBeenCalledWith(PATH, 'request', 'Check tray 2 again'))
    await waitFor(() => expect(h.getByRole('textbox', { name: 'Add note' })).toHaveValue(''))
  }, 15000)

  test('add note sends a note', async () => {
    const user = userEvent.setup()
    const { header } = await openPage()
    const h = within(header)
    mocked.workNote.mockImplementation(async (p: string) => workWriteResult({ item: printer({ path: p, version: 'v2' }) }))
    await user.click(h.getByRole('button', { name: 'Add note' }))
    await user.type(h.getByRole('textbox', { name: 'Add note' }), '   ')
    await user.click(h.getByRole('button', { name: 'Add note' }))
    expect(mocked.workNote).not.toHaveBeenCalled()
    await user.clear(h.getByRole('textbox', { name: 'Add note' }))
    await user.type(h.getByRole('textbox', { name: 'Add note' }), 'Swapped the cable')
    await user.click(h.getByRole('button', { name: 'Add note' }))
    await waitFor(() => expect(mocked.workNote).toHaveBeenCalledWith(PATH, 'note', 'Swapped the cable'))
    expect(mocked.workNote).toHaveBeenCalledTimes(1)
  }, 15000)

  test('close shows for a close turn', async () => {
    const user = userEvent.setup()
    item = printer({ turn: 'close', deskSays: 'Resolved' })
    mocked.workClose.mockImplementation(async (p: string) =>
      workWriteResult({ version: 'v2', item: printer({ path: p, version: 'v2', turn: 'none', done: true }) }),
    )
    const { header } = await openPage()
    const h = within(header)
    expect(h.getByText('Desk says Resolved')).toBeInTheDocument()
    await user.click(h.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(mocked.workClose).toHaveBeenCalledWith(PATH, 'v1'))
    await waitFor(() => expect(h.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument())
  }, 15000)
})
