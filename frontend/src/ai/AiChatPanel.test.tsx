// M10: the AI chat side-panel entry.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import type { AiChatRequest, AiEvent } from '@/api/types'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { isAiChatTarget } from '@/nav/sidepanel'
import { activeTab, useTabs } from '@/nav/tabs'
import { usePalette } from '@/palette/usePalette'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { objectDetail, objectSummary, references } from '@/test/mockApi'
import { AiChatPanel } from './AiChatPanel'
import { noticeKey } from './reveal'
import { AI_CHAT_TEXT as T } from './aiText'
import { openAiChat, resetAiStore, useAi } from './store'

const mocked = vi.mocked(api)
const s = useTabs.getState
const tab = () => activeTab(s())!
const aiEntry = () => (tab().sidepanel ?? []).find((e) => isAiChatTarget(e.target))

/** Renders the chat for the tab's AI chat entry, following its target as the store changes it. */
function Harness() {
  const entry = useTabs((st) => (activeTab(st)?.sidepanel ?? []).find((e) => isAiChatTarget(e.target)))
  if (!entry || !isAiChatTarget(entry.target)) return null
  return <AiChatPanel key={entry.id} entryId={entry.id} path={entry.target.path} />
}

type OnEvent = (e: AiEvent) => void

/** An `aiChat` that emits `events` (then resolves). */
function answer(...events: AiEvent[]) {
  return async (_req: AiChatRequest, onEvent: OnEvent) => {
    for (const e of events) onEvent(e)
  }
}

const done = (text: string, extra: Partial<Extract<AiEvent, { type: 'done' }>> = {}): AiEvent => ({
  type: 'done',
  text,
  sessionId: 's1',
  proposal: null,
  skipped: [],
  ...extra,
})

function setup(opts: { path?: string } = {}) {
  s().open({ kind: 'object', path: 'Pages/A.md' })
  s().openInSidepanel(opts.path ? { kind: 'aiChat', path: opts.path } : { kind: 'aiChat' })
  const user = userEvent.setup()
  const view = render(<Harness />)
  return { user, ...view }
}

const input = () => screen.getByRole('textbox', { name: T.inputLabel })

beforeEach(() => {
  vi.clearAllMocks()
  // Back to the mock's own answers (a test's mockResolvedValue would outlive it).
  for (const fn of [mocked.aiStatus, mocked.aiChat, mocked.aiChatLoad, mocked.saveAiChat, mocked.object, mocked.saveBody, mocked.references, mocked.updateProperties])
    fn.mockReset()
  localStorage.clear()
  localStorage.setItem(noticeKey(null), '1')
  localStorage.setItem(noticeKey('/space'), '1')
  s().reset()
  resetAiStore()
  resetLinkIndex()
  resetSpaceInfo()
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
  usePalette.setState({ open: false, mode: 'search' })
  useLinkIndex.setState({
    objects: [objectSummary({ path: 'Pages/A.md', title: 'Alpha' }), objectSummary({ path: 'Pages/B.md', title: 'Beta' })],
    loaded: true,
  })
})

describe('AiChatPanel', () => {
  test('test Enter sends, Shift+Enter is a newline; the turn is shown and saved', async () => {
    const { user } = setup()
    // The default context is the tab's open object.
    const chips = screen.getByRole('list', { name: T.context })
    expect(within(chips).getByText('Alpha')).toBeInTheDocument()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalledTimes(1))
    await user.type(input(), 'First line{Shift>}{Enter}{/Shift}second')
    expect(input()).toHaveValue('First line\nsecond')
    expect(mocked.aiChat).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(1))
    expect(mocked.aiChat.mock.calls[0][0]).toMatchObject({
      mode: 'chat',
      prompt: 'First line\nsecond',
      contextPaths: ['Pages/A.md'],
      history: [],
      sessionId: null,
    })
    expect(input()).toHaveValue('')
    const list = screen.getByRole('list', { name: T.title })
    expect(await within(list).findByText('Hello')).toBeInTheDocument()
    expect(within(list).getByText('First line second', { normalizer: (t) => t.replace(/\s+/g, ' ') })).toBeInTheDocument()

    // Saved after the turn (created), and the entry now names the chat.
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(1))
    expect(mocked.saveAiChat.mock.calls[0][0]).toMatchObject({
      path: null,
      baseVersion: null,
      title: 'First line',
      contextPaths: ['Pages/A.md'],
      sessionId: 's1',
      messages: [
        { role: 'user', text: 'First line\nsecond' },
        { role: 'assistant', text: 'Hello' },
      ],
    })
    await waitFor(() => expect(aiEntry()?.target).toEqual({ kind: 'aiChat', path: 'AI Chats/Chat.md' }))
    // The chat was not loaded again: it is the one shown.
    expect(mocked.aiChatLoad).not.toHaveBeenCalled()

    // A second turn resumes the session and saves by version.
    await user.type(input(), 'More{Enter}')
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(2))
    expect(mocked.aiChat.mock.calls[1][0]).toMatchObject({ sessionId: 's1', history: [{ role: 'user' }, { role: 'assistant', text: 'Hello' }] })
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(2))
    expect(mocked.saveAiChat.mock.calls[1][0]).toMatchObject({ path: 'AI Chats/Chat.md', baseVersion: 'v1' })
  })

  test('test streaming shows the tools used, and Stop aborts', async () => {
    let signal: AbortSignal | undefined
    mocked.aiChat.mockImplementation(async (_req, onEvent, sig) => {
      signal = sig
      onEvent({ type: 'tool', id: 't1', name: 'search', input: { query: 'rack' } })
      onEvent({ type: 'text', text: 'Partial' })
      await new Promise<void>((_resolve, reject) => sig?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    })
    const { user } = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'Find it{Enter}')
    expect(await screen.findByText('Searching your notes…')).toBeInTheDocument()
    expect(screen.getByText(`${T.usedTools} search`)).toBeInTheDocument()
    expect(screen.getByText('Partial')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: T.stop }))
    expect(signal?.aborted).toBe(true)
    expect(await screen.findByText(T.stopped)).toBeInTheDocument()
    expect(screen.getByText('Partial')).toBeInTheDocument()
    expect(screen.queryByText('Searching your notes…')).toBeNull()
    // A stopped turn is not saved.
    expect(mocked.saveAiChat).not.toHaveBeenCalled()
  })

  test('test an error event shows its message', async () => {
    mocked.aiChat.mockImplementation(answer({ type: 'error', message: 'Claude Code stopped.' }))
    const { user } = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'Hi{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Claude Code stopped.')
    expect(mocked.saveAiChat).not.toHaveBeenCalled()
  })

  test('test Claude Code not found shows the explanation instead of the input', async () => {
    mocked.aiStatus.mockResolvedValue({ available: false, reason: 'notFound', claudePath: null, version: null, message: null })
    setup()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(T.notFound)
    expect(alert).toHaveTextContent('Install Claude Code and sign in, or set its path in Settings > AI Assistant.')
    expect(screen.queryByRole('textbox', { name: T.inputLabel })).toBeNull()
  })

  test('test not signed in shows its message', async () => {
    mocked.aiStatus.mockResolvedValue({ available: false, reason: 'notSignedIn', claudePath: '/c', version: '2', message: 'Run claude to sign in.' })
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('Run claude to sign in.')
  })

  test('test first-use notice: shown once per space, a seeded request waits for OK', async () => {
    localStorage.clear()
    act(() => useAi.getState().open({ mode: 'tagObject', contextPaths: ['Pages/B.md'] }))
    const { user } = setup()
    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent(
      'AI Chat sends the pages in its context, and anything it reads with Object\'s search tools, to Anthropic through your Claude Code. Pages tagged "Exclude from AI" are never sent.',
    )
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    expect(mocked.aiChat).not.toHaveBeenCalled()
    await user.click(within(note).getByRole('button', { name: 'OK' }))
    expect(screen.queryByRole('note')).toBeNull()
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(1))
    expect(mocked.aiChat.mock.calls[0][0]).toMatchObject({ mode: 'tagObject', prompt: '', contextPaths: ['Pages/B.md'] })
    await waitFor(() => expect(localStorage.getItem(noticeKey('/space'))).toBe('1'))
  })

  test('test a tags proposal: Accept adds the union of tags with the version; Dismiss hides it', async () => {
    mocked.object.mockResolvedValue(objectDetail({ summary: objectSummary({ path: 'Pages/A.md', tags: ['ops'] }), version: 'v7' }))
    mocked.aiChat.mockImplementation(answer(done('Try these.', { proposal: { kind: 'tags', tags: ['Ops', 'runbook'] } })))
    const { user } = setup()
    act(() => openAiChat({ mode: 'tagObject' }))
    const box = await screen.findByRole('region', { name: T.proposedTags })
    expect(within(box).getByText('runbook')).toBeInTheDocument()
    // Nothing written before the click.
    expect(mocked.updateProperties).not.toHaveBeenCalled()
    await user.click(within(box).getByRole('button', { name: T.accept }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Pages/A.md', { tags: ['ops', 'runbook'] }, 'v7'))
    expect(await within(box).findByText(T.accepted)).toBeInTheDocument()

    // Another proposal, dismissed.
    await user.type(input(), 'again{Enter}')
    await waitFor(() => expect(screen.getAllByRole('region', { name: T.proposedTags })).toHaveLength(2))
    const second = screen.getAllByRole('region', { name: T.proposedTags })[1]
    await user.click(within(second).getByRole('button', { name: T.dismiss }))
    expect(screen.getAllByRole('region', { name: T.proposedTags })).toHaveLength(1)
    expect(mocked.updateProperties).toHaveBeenCalledTimes(1)
  })

  test('test a properties proposal: a table; Accept writes only those keys', async () => {
    mocked.object.mockResolvedValue(objectDetail({ summary: objectSummary({ path: 'Pages/A.md' }), version: 'v2' }))
    mocked.aiChat.mockImplementation(
      answer(done('', { proposal: { kind: 'properties', values: { owner: 'Gene', due: '2026-11-09' } }, skipped: [
          { path: 'Pages/B.md', reason: 'excluded' },
          { path: 'Pages/Gone.md', reason: 'tooLong' },
        ] })),
    )
    const { user } = setup()
    act(() => openAiChat({ mode: 'autofill' }))
    const box = await screen.findByRole('region', { name: T.proposedProperties })
    const rows = within(box).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.textContent)).toEqual(['ownerGene', 'due2026-11-09'])
    // The excluded page is named.
    expect(screen.getByText('Left out: Beta (excluded from AI), Gone (too long)')).toBeInTheDocument()
    await user.click(within(box).getByRole('button', { name: T.accept }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Pages/A.md', { owner: 'Gene', due: '2026-11-09' }, 'v2'))
  })

  test('test a text proposal with editor callbacks: Replace and Insert below; Copy without them', async () => {
    const onReplace = vi.fn()
    const onInsertBelow = vi.fn()
    mocked.aiChat.mockImplementation(answer(done('Here.', { proposal: { kind: 'text', text: 'Better text' } })))
    const { user } = setup()
    act(() => openAiChat({ mode: 'rephrase', block: 'Old text', onReplace, onInsertBelow }))
    const box = await screen.findByRole('region', { name: T.proposedText })
    expect(mocked.aiChat.mock.calls[0][0]).toMatchObject({ mode: 'rephrase', block: 'Old text' })
    // The block shows as a context chip.
    expect(within(screen.getByRole('list', { name: T.context })).getByText(T.block)).toBeInTheDocument()
    await user.click(within(box).getByRole('button', { name: T.replace }))
    expect(onReplace).toHaveBeenCalledWith('Better text')
    await user.click(within(box).getByRole('button', { name: T.insertBelow }))
    expect(onInsertBelow).toHaveBeenCalledWith('Better text')
    expect(within(box).queryByRole('button', { name: T.copy })).toBeNull()
    // The message's own Replace / Insert below use the whole answer.
    await user.click(within(screen.getByRole('group', { name: T.assistant })).getByRole('button', { name: T.replace }))
    expect(onReplace).toHaveBeenLastCalledWith('Here.')

    // A new seed without callbacks: only Copy.
    mocked.aiChat.mockImplementation(answer(done('Here.', { proposal: { kind: 'text', text: 'Plain' } })))
    act(() => openAiChat({ mode: 'askBlock', block: 'x' }))
    const plain = await screen.findByRole('region', { name: T.proposedText })
    await waitFor(() => expect(within(plain).getByText('Plain')).toBeInTheDocument())
    expect(within(plain).queryByRole('button', { name: T.replace })).toBeNull()
    await user.click(within(plain).getByRole('button', { name: T.copy }))
    expect(await navigator.clipboard.readText()).toBe('Plain')
  })

  test('test Append to page appends with the version, reloading once on a conflict', async () => {
    mocked.object
      .mockResolvedValueOnce(objectDetail({ summary: objectSummary({ path: 'Pages/A.md' }), body: 'Old\n', version: 'v1' }))
      .mockResolvedValueOnce(objectDetail({ summary: objectSummary({ path: 'Pages/A.md' }), body: 'Newer\n', version: 'v2' }))
    mocked.saveBody.mockRejectedValueOnce(new ConflictError('v2'))
    const { user } = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'Q{Enter}')
    const list = screen.getByRole('list', { name: T.title })
    await within(list).findByText('Hello')
    await user.click(screen.getByRole('button', { name: T.appendToPage }))
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledTimes(2))
    expect(mocked.saveBody).toHaveBeenNthCalledWith(1, 'Pages/A.md', 'Old\n\nHello\n', 'v1')
    expect(mocked.saveBody).toHaveBeenNthCalledWith(2, 'Pages/A.md', 'Newer\n\nHello\n', 'v2')
  })

  test('test Append to daily note writes today’s note; without context Append to page is disabled', async () => {
    const { user } = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: T.removeContext('Alpha') }))
    expect(within(screen.getByRole('list', { name: T.context })).queryByText('Alpha')).toBeNull()
    await user.type(input(), 'Q{Enter}')
    await screen.findByRole('button', { name: T.appendToDailyNote })
    expect(mocked.aiChat.mock.calls[0][0]).toMatchObject({ contextPaths: [] })
    expect(screen.getByRole('button', { name: T.appendToPage })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: T.appendToDailyNote }))
    await waitFor(() => expect(mocked.createDailyNote).toHaveBeenCalled())
    const day = mocked.createDailyNote.mock.calls[0][0]
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledWith(`DailyNotes/${day}.md`, 'Hello\n', 'v1'))
  })

  test('test Retry resends the last question; Rephrase sends the answer in rephrase mode', async () => {
    const { user } = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'Why?{Enter}')
    await screen.findByRole('button', { name: T.retry })
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: T.retry }))
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(2))
    expect(mocked.aiChat.mock.calls[1][0]).toMatchObject({ mode: 'chat', prompt: 'Why?', history: [], sessionId: null })
    await waitFor(() => expect(screen.getAllByText('Hello')).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: T.rephrase }))
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(3))
    expect(mocked.aiChat.mock.calls[2][0]).toMatchObject({ mode: 'rephrase', prompt: '', block: 'Hello' })
    expect(await screen.findByText('Rephrase')).toBeInTheDocument()
  })

  test('test a saved chat loads by path; New chat clears it', async () => {
    mocked.aiChatLoad.mockResolvedValue({
      path: 'AI Chats/Old.md',
      version: 'v3',
      title: 'Old',
      contextPaths: ['Pages/B.md'],
      sessionId: 'sess-old',
      messages: [
        { role: 'user', text: 'Earlier question', at: '2026-11-05T10:00:00Z' },
        { role: 'assistant', text: 'Earlier answer', at: '2026-11-05T10:00:01Z' },
      ],
    })
    const { user } = setup({ path: 'AI Chats/Old.md' })
    expect(await screen.findByText('Earlier answer')).toBeInTheDocument()
    expect(mocked.aiChatLoad).toHaveBeenCalledWith('AI Chats/Old.md')
    expect(within(screen.getByRole('list', { name: T.context })).getByText('Beta')).toBeInTheDocument()
    await user.type(input(), 'Next{Enter}')
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalled())
    expect(mocked.aiChat.mock.calls[0][0]).toMatchObject({ sessionId: 'sess-old', contextPaths: ['Pages/B.md'] })
    expect(mocked.saveAiChat.mock.calls[0][0]).toMatchObject({ path: 'AI Chats/Old.md', baseVersion: 'v3' })

    await user.click(screen.getByRole('button', { name: T.newChat }))
    expect(screen.queryByText('Earlier answer')).toBeNull()
    expect(aiEntry()?.target).toEqual({ kind: 'aiChat' })
    expect(within(screen.getByRole('list', { name: T.context })).getByText('Alpha')).toBeInTheDocument()
  })

  test('test a stale save reloads the chat and saves again', async () => {
    mocked.saveAiChat
      .mockResolvedValueOnce({ path: 'AI Chats/C.md', version: 'v1' })
      .mockRejectedValueOnce(new ConflictError('v9'))
      .mockResolvedValueOnce({ path: 'AI Chats/C.md', version: 'v10' })
    mocked.aiChatLoad.mockResolvedValue({ path: 'AI Chats/C.md', version: 'v9', title: 'x', contextPaths: [], sessionId: null, messages: [] })
    const { user } = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'One{Enter}')
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(1))
    await user.type(input(), 'Two{Enter}')
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(3))
    expect(mocked.aiChatLoad).toHaveBeenCalledWith('AI Chats/C.md')
    expect(mocked.saveAiChat.mock.calls[2][0]).toMatchObject({ path: 'AI Chats/C.md', baseVersion: 'v9' })
    expect(mocked.saveAiChat.mock.calls[2][0].messages).toHaveLength(4)
  })

  test('test a block goes with its page; a rephrased answer goes without one', async () => {
    mocked.aiChat.mockImplementation(answer(done('Answer one')))
    const { user } = setup()
    act(() => openAiChat({ mode: 'askBlock', block: 'Block text', blockPath: 'Pages/A.md' }))
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(1))
    expect(mocked.aiChat.mock.calls[0][0]).toMatchObject({ mode: 'askBlock', block: 'Block text', blockPath: 'Pages/A.md' })
    await screen.findByText('Answer one')
    // A typed follow-up still carries the block chip and its page.
    await user.type(input(), 'More{Enter}')
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(2))
    expect(mocked.aiChat.mock.calls[1][0]).toMatchObject({ block: 'Block text', blockPath: 'Pages/A.md' })
    await waitFor(() => expect(screen.getAllByRole('button', { name: T.rephrase })[0]).toBeEnabled())
    await user.click(screen.getAllByRole('button', { name: T.rephrase })[0])
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(3))
    expect(mocked.aiChat.mock.calls[2][0]).toMatchObject({ mode: 'rephrase', block: 'Answer one', blockPath: null })
    expect(mocked.aiChat.mock.calls[2][0].history).toContainEqual(expect.objectContaining({ role: 'assistant', text: 'Answer one' }))
  })

  test('test a later save sends no title, so a rename made elsewhere stays', async () => {
    const { user } = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'One{Enter}')
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(1))
    expect(mocked.saveAiChat.mock.calls[0][0]).toMatchObject({ title: 'One' })
    await user.type(input(), 'Two{Enter}')
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(2))
    expect(mocked.saveAiChat.mock.calls[1][0].path).toBe('AI Chats/Chat.md')
    expect(mocked.saveAiChat.mock.calls[1][0].title).toBeUndefined()
  })

  test('test a stale save over messages changed elsewhere stops and says so', async () => {
    mocked.saveAiChat.mockResolvedValueOnce({ path: 'AI Chats/C.md', version: 'v1' }).mockRejectedValueOnce(new ConflictError('v9'))
    mocked.aiChatLoad.mockResolvedValue({
      path: 'AI Chats/C.md',
      version: 'v9',
      title: 'Renamed',
      contextPaths: [],
      sessionId: null,
      messages: [{ role: 'user', text: 'Edited elsewhere', at: '2026-11-05T09:00:00Z' }],
    })
    const { user } = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'One{Enter}')
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(1))
    await user.type(input(), 'Two{Enter}')
    expect(await screen.findByText(T.changedElsewhere)).toBeInTheDocument()
    expect(mocked.aiChatLoad).toHaveBeenCalledWith('AI Chats/C.md')
    expect(mocked.saveAiChat).toHaveBeenCalledTimes(2)
  })

  test('test Accept writes to the page the proposal was made for, not the context at the click', async () => {
    mocked.object.mockResolvedValue(objectDetail({ summary: objectSummary({ path: 'Pages/A.md', tags: [] }), version: 'v4' }))
    mocked.aiChat.mockImplementation(answer(done('Try these.', { proposal: { kind: 'tags', tags: ['ops'] } })))
    const { user } = setup()
    act(() => openAiChat({ mode: 'tagObject', contextPaths: ['Pages/A.md'] }))
    const box = await screen.findByRole('region', { name: T.proposedTags })
    // The context changes after the proposal came back.
    await user.click(screen.getByRole('button', { name: T.removeContext('Alpha') }))
    await user.click(screen.getByRole('button', { name: T.addContext }))
    await user.click(await screen.findByRole('option', { name: 'Beta' }))
    await user.click(within(box).getByRole('button', { name: T.accept }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Pages/A.md', { tags: ['ops'] }, 'v4'))
    expect(mocked.object).not.toHaveBeenCalledWith('Pages/B.md', expect.anything())
  })

  test('test an AltGr character typed in the message box is text, not a shortcut', async () => {
    mocked.object.mockResolvedValue(objectDetail({ summary: objectSummary({ path: 'Pages/A.md' }), body: '', version: 'v1' }))
    const { user } = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'Q{Enter}')
    await screen.findByRole('button', { name: T.retry })
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(1))
    // Polish AltGr+A ("ą"): Windows reports Ctrl+Alt with the A key.
    const typed = fireEvent.keyDown(input(), { key: 'ą', code: 'KeyA', ctrlKey: true, altKey: true })
    expect(typed).toBe(true) // not prevented: the character is typed
    await new Promise((r) => setTimeout(r, 20))
    expect(mocked.saveBody).not.toHaveBeenCalled()
    // From elsewhere in the panel the same keys are the shortcut.
    fireEvent.keyDown(screen.getByRole('button', { name: T.newChat }), { key: 'ą', code: 'KeyA', ctrlKey: true, altKey: true })
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledWith('Pages/A.md', 'Hello\n', 'v1'))
  })

  test('test a seed’s range tracking is released when another seed or New chat replaces it', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { user } = setup()
    act(() => openAiChat({ mode: 'chat', block: 'x', blockPath: 'Pages/A.md', release: first }))
    await waitFor(() => expect(within(screen.getByRole('list', { name: T.context })).getByText(T.block)).toBeInTheDocument())
    expect(first).not.toHaveBeenCalled()
    act(() => openAiChat({ mode: 'chat', block: 'y', blockPath: 'Pages/A.md', release: second }))
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: T.newChat }))
    expect(second).toHaveBeenCalledTimes(1)
  })

  test('test chat keys act on the last answer while the panel has focus', async () => {
    const { user } = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'Q{Enter}')
    await screen.findByRole('button', { name: T.retry })
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(1))
    input().focus()
    await user.keyboard('{Control>}{Alt>}c{/Alt}{/Control}')
    expect(await navigator.clipboard.readText()).toBe('Hello')
    await user.keyboard('{Control>}{Alt>}r{/Alt}{/Control}')
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(2))
    await user.keyboard('{Control>}{Alt>}u{/Alt}{/Control}')
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(3))
    expect(mocked.aiChat.mock.calls[2][0]).toMatchObject({ mode: 'rephrase' })
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(3))
    await user.keyboard('{Control>}{Alt>}a{/Alt}{/Control}')
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledWith('Pages/A.md', 'Hello\n', expect.anything()))
    await user.keyboard('{Control>}{Alt>}x{/Alt}{/Control}')
    expect(aiEntry()).toBeUndefined()
  })

  test('test Relevant Content lists related objects; Find More opens search', async () => {
    mocked.references.mockResolvedValue(
      references({ related: [{ path: 'Pages/B.md', score: 2 }], summaries: { 'Pages/B.md': objectSummary({ path: 'Pages/B.md', title: 'Beta' }) } }),
    )
    const { user } = setup()
    const section = screen.getByRole('region', { name: 'Relevant Content' })
    expect(await within(section).findByText('Beta')).toBeInTheDocument()
    expect(mocked.references).toHaveBeenCalledWith('Pages/A.md', expect.anything())
    await user.click(within(section).getByRole('button', { name: 'Find More' }))
    expect(usePalette.getState()).toMatchObject({ open: true, mode: 'search' })
  })

  test('test adding a page to the context', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: T.addContext }))
    await user.click(await screen.findByRole('option', { name: 'Beta' }))
    const chips = screen.getByRole('list', { name: T.context })
    expect(within(chips).getByText('Alpha')).toBeInTheDocument()
    expect(within(chips).getByText('Beta')).toBeInTheDocument()
  })

  test('test hidden: nothing shows and the entry closes', async () => {
    setup()
    expect(screen.getByRole('textbox', { name: T.inputLabel })).toBeInTheDocument()
    act(() => useSettings.setState({ settings: { ...settingsDefaults, aiHidden: true } }))
    expect(screen.queryByRole('textbox', { name: T.inputLabel })).toBeNull()
    expect(aiEntry()).toBeUndefined()
  })
})
