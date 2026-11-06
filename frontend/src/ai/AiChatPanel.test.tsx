// M10 (and M16, M17): the AI chat side-panel entry.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError, ConflictError } from '@/api/client'
import type { AiChatRequest, AiEvent, ChangeEvent } from '@/api/types'
import { resetAgents, useAgents } from '@/agents/useAgents'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { isAiChatTarget } from '@/nav/sidepanel'
import { activeTab, currentTarget, useTabs } from '@/nav/tabs'
import { usePalette } from '@/palette/usePalette'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { agent, agentTranscript, objectDetail, objectSummary, references, reviewStatus } from '@/test/mockApi'
import { useLearningFocus } from '@/agents/learningFocus'
import { CHAT_MENU_TEXT } from './ChatMenu'
import { LEARNING_LINE_TEXT } from './LearningLine'
import { AGENT_PICKER_TEXT } from './AgentPicker'
import { AiChatHeader } from './AiChatHeader'
import { AiChatPanel } from './AiChatPanel'
import { assertInert } from './markdown'
import { noticeKey, revealAiChat, useAiFocus } from './reveal'
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
  const t = entry.target
  return <AiChatPanel key={entry.id} entryId={entry.id} path={t.path} agentId={t.agentId} chatId={t.chatId} />
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

function setup(opts: { path?: string; agentId?: string; chatId?: string } = {}) {
  s().open({ kind: 'object', path: 'Pages/A.md' })
  s().openInSidepanel({
    kind: 'aiChat',
    ...(opts.path ? { path: opts.path } : {}),
    ...(opts.agentId ? { agentId: opts.agentId } : {}),
    ...(opts.chatId ? { chatId: opts.chatId } : {}),
  })
  const user = userEvent.setup()
  const view = render(<Harness />)
  return { user, ...view }
}

const input = () => screen.getByRole('textbox', { name: T.inputLabel })
const picker = () => screen.getByRole('button', { name: AGENT_PICKER_TEXT.label })

const RESEARCHER = '01JRESEARCHER0000000000000'
const CHAT_ID = '01JCHAT0000000000000000000'

beforeEach(() => {
  vi.clearAllMocks()
  // Back to the mock's own answers (a test's mockResolvedValue would outlive it).
  for (const fn of [mocked.aiStatus, mocked.aiChat, mocked.aiChatLoad, mocked.saveAiChat, mocked.object, mocked.saveBody, mocked.references, mocked.updateProperties, mocked.agentChat, mocked.agents, mocked.chatReviews, mocked.learnFromChat, mocked.onChange])
    fn.mockReset()
  localStorage.clear()
  localStorage.setItem(noticeKey(null), '1')
  localStorage.setItem(noticeKey('/space'), '1')
  s().reset()
  resetAiStore()
  // A focus request from an earlier test (Ctrl+Alt+J) would focus the input on the next mount
  // and close a popover opened before the frame runs.
  useAiFocus.setState({ n: 0 })
  resetLinkIndex()
  resetSpaceInfo()
  resetAgents()
  useAgents.setState({ agents: [agent({ id: 'assistant' }), agent({ id: RESEARCHER, model: 'claude-opus-5-5' })], loaded: true })
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
    // M16: the user message renders as Markdown; its single line break is kept (a <br>).
    const asked = list.querySelector('[data-role="user"] p')!
    expect(asked.innerHTML.replace(/\s+/g, '')).toBe('Firstline<br>second')

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
    // M16: the tool shows as a step row, not a "Used:" line.
    expect(screen.getByRole('button', { name: "Searched notes for 'rack'" })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/^Used:/)).toBeNull()
    expect(await screen.findByText('Partial')).toBeInTheDocument()
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
      agent: null,
      agentId: 'assistant',
      chatId: null,
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
    mocked.aiChatLoad.mockResolvedValue({
      path: 'AI Chats/C.md',
      version: 'v9',
      title: 'x',
      contextPaths: [],
      sessionId: null,
      messages: [],
      agent: null,
      agentId: 'assistant',
      chatId: null,
    })
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
      agent: null,
      agentId: 'assistant',
      chatId: null,
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

  // ---- M16 ----

  test('test assistant and user messages render Markdown', async () => {
    const source = '# Plan\n\n**bold**, ~~old~~ and a table\n\n| a | b |\n|---|---|\n| 1 | 2 |'
    mocked.aiChat.mockImplementation(answer({ type: 'text', text: source }, done(source)))
    const { user } = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), '**hi**{Enter}')
    const list = screen.getByRole('list', { name: T.title })
    await waitFor(() => expect(list.querySelector('[data-role="assistant"]:not([data-streaming]) h1')).not.toBeNull())
    const reply = list.querySelector('[data-role="assistant"]:not([data-streaming])')!
    expect(reply.querySelector('h1')).toHaveTextContent('Plan')
    expect(reply.querySelector('strong')).toHaveTextContent('bold')
    expect(reply.querySelector('del')).toHaveTextContent('old')
    expect(reply.querySelector('table')).not.toBeNull()
    const mine = list.querySelector('[data-role="user"]')!
    expect(mine.querySelector('strong')).toHaveTextContent('hi')
  })

  test('test Copy copies the Markdown source and the save stores it', async () => {
    const source = '# Title\n\n**bold** and `x`\n\n- [ ] task\n\n$x^2$'
    mocked.aiChat.mockImplementation(answer({ type: 'text', text: source }, done(source)))
    const { user } = setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText')
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'Q{Enter}')
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(1))
    expect(mocked.saveAiChat.mock.calls[0][0].messages[1]).toMatchObject({ role: 'assistant', text: source })
    await user.click(screen.getByRole('button', { name: T.copy }))
    expect(write).toHaveBeenCalledWith(source)
    expect(await navigator.clipboard.readText()).toBe(source)
  })

  test("test a reply's HTML is shown as text", async () => {
    const source = '<img src=x onerror=alert(1)><script>x</script>'
    mocked.aiChat.mockImplementation(answer({ type: 'text', text: source }, done(source)))
    const { user, container } = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'Q{Enter}')
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalled())
    const panel = container.querySelector('[data-ai-chat]') as HTMLElement
    expect(panel.querySelector('[data-role="assistant"]')).toHaveTextContent('<script>x</script>')
    expect(panel.querySelector('img')).toBeNull()
    expect(panel.querySelector('script')).toBeNull()
    assertInert(panel.innerHTML)
  })

  test('test tool steps sit between the texts, collapsed', async () => {
    mocked.aiChat.mockImplementation(
      answer(
        { type: 'text', text: 'Let me look.' },
        { type: 'tool', id: 't1', name: 'search', input: { query: 'rack' } },
        { type: 'tool', id: 't1', name: 'search', input: null, result: '[]', isError: false },
        { type: 'text', text: 'Found it.' },
        done('Let me look.Found it.'),
      ),
    )
    const { user } = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'Find rack{Enter}')
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalled())
    const list = screen.getByRole('list', { name: T.title })
    const reply = list.querySelector('[data-role="assistant"]') as HTMLElement
    const first = within(reply).getByText('Let me look.')
    const step = within(reply).getByRole('button', { name: "Searched notes for 'rack'" })
    const second = within(reply).getByText('Found it.')
    expect(step).toHaveAttribute('aria-expanded', 'false')
    expect(first.compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(step.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await user.click(step)
    expect(step).toHaveAttribute('aria-expanded', 'true')
    expect(within(reply).getByText('Input')).toBeInTheDocument()
    expect(within(reply).getByText('Result')).toBeInTheDocument()
    // The save holds the Markdown source only.
    expect(mocked.saveAiChat.mock.calls[0][0].messages[1].text).toBe('Let me look.Found it.')
  })

  test("test a step still pending when 'done' arrives is marked stopped", async () => {
    mocked.aiChat.mockImplementation(
      answer(
        { type: 'tool', id: 't1', name: 'search', input: { query: 'rack' } },
        { type: 'text', text: 'Found it.' },
        done('Found it.'),
      ),
    )
    const { user } = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'Find rack{Enter}')
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalled())
    const reply = screen.getByRole('list', { name: T.title }).querySelector('[data-role="assistant"]') as HTMLElement
    expect(within(reply).getByRole('button', { name: "Searched notes for 'rack' (stopped)" })).toBeInTheDocument()
    expect(within(reply).getByText('Found it.')).toBeInTheDocument()
  })

  test('test Stop leaves a pending step marked stopped', async () => {
    mocked.aiChat.mockImplementation(async (_req, onEvent, sig) => {
      onEvent({ type: 'text', text: 'Looking' })
      onEvent({ type: 'tool', id: 't1', name: 'search', input: { query: 'rack' } })
      await new Promise<void>((_resolve, reject) => sig?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    })
    const { user } = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'Find it{Enter}')
    await screen.findByRole('button', { name: "Searched notes for 'rack'" })
    await user.click(screen.getByRole('button', { name: T.stop }))
    expect(await screen.findByRole('button', { name: "Searched notes for 'rack' (stopped)" })).toBeInTheDocument()
    expect(screen.getByText('Looking')).toBeInTheDocument()
    expect(screen.getByText(T.stopped)).toBeInTheDocument()
  })

  test('test Stop with no text before the tool call keeps the step, marked stopped', async () => {
    mocked.aiChat.mockImplementation(async (_req, onEvent, sig) => {
      onEvent({ type: 'tool', id: 't1', name: 'search', input: { query: 'rack' } })
      await new Promise<void>((_resolve, reject) => sig?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    })
    const { user } = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'Find it{Enter}')
    await screen.findByRole('button', { name: "Searched notes for 'rack'" })
    await user.click(screen.getByRole('button', { name: T.stop }))
    expect(await screen.findByRole('button', { name: "Searched notes for 'rack' (stopped)" })).toBeInTheDocument()
    expect(screen.getByText(T.stopped)).toBeInTheDocument()
  })

  test('test an answer with tool steps between its texts: Copy and the save hold what is shown', async () => {
    mocked.aiChat.mockImplementation(
      answer(
        { type: 'text', text: 'Let me look.' },
        { type: 'tool', id: 't1', name: 'search', input: { query: 'rack' } },
        { type: 'tool', id: 't1', name: 'search', input: null, result: '[]', isError: false },
        { type: 'text', text: '\n\nFound it.' },
        // The CLI's result is only the last assistant message.
        done('Found it.'),
      ),
    )
    const { user } = setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText')
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'Find rack{Enter}')
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(1))
    const reply = screen.getByRole('list', { name: T.title }).querySelector('[data-role="assistant"]') as HTMLElement
    expect(within(reply).getByText('Let me look.')).toBeInTheDocument()
    expect(within(reply).getByText('Found it.')).toBeInTheDocument()
    const shown = 'Let me look.\n\nFound it.'
    expect(mocked.saveAiChat.mock.calls[0][0].messages[1]).toMatchObject({ role: 'assistant', text: shown })
    await user.click(within(reply).getByRole('button', { name: T.copy }))
    expect(write).toHaveBeenCalledWith(shown)
  })

  test("test the header's model picker sets this chat's model", async () => {
    const { user } = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'One{Enter}')
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(1))
    expect(mocked.aiChat.mock.calls[0][0]).toMatchObject({ model: null })

    const trigger = screen.getByRole('button', { name: T.modelForChat })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'Opus 5.5' }))
    expect(trigger).toHaveTextContent('Opus 5.5')
    await user.type(input(), 'Two{Enter}')
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(2))
    expect(mocked.aiChat.mock.calls[1][0]).toMatchObject({ model: 'claude-opus-5-5', sessionId: 's1' })
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(2))

    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'Default' }))
    await user.type(input(), 'Three{Enter}')
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(3))
    expect(mocked.aiChat.mock.calls[2][0]).toMatchObject({ model: null, sessionId: 's1' })
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(3))

    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'Haiku 5.5' }))
    expect(trigger).toHaveTextContent('Haiku 5.5')
    await user.click(screen.getByRole('button', { name: T.newChat }))
    expect(screen.getByRole('button', { name: T.modelForChat })).toHaveTextContent(/^Default$/)
  })

  test('test the Default row names the Settings model', async () => {
    useSettings.setState({ settings: { ...settingsDefaults, aiModel: 'claude-sonnet-5-5' } })
    const { user } = setup()
    const trigger = screen.getByRole('button', { name: T.modelForChat })
    await user.click(trigger)
    expect(await screen.findByRole('option', { name: 'Default (Sonnet 5.5)' })).toHaveAttribute('aria-selected', 'true')
    // The trigger says Default; only the Default row names the Settings model.
    expect(trigger).toHaveTextContent(/^Default$/)
  })

  test('test the header renders the leading slot', () => {
    render(<AiChatHeader leading={<span>Agent</span>} model={null} defaultModel={null} onModelChange={() => {}} onNewChat={() => {}} />)
    expect(screen.getByText('Agent')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: T.modelForChat })).toHaveTextContent('Default')
    expect(screen.getByRole('button', { name: T.newChat })).toBeInTheDocument()
  })

  // ---- M17: chats belong to agents ----

  test('test the header shows the agent picker in the leading slot', async () => {
    const { user } = setup()
    expect(picker()).toHaveTextContent('Assistant')
    // The picker comes before the model picker and New chat in the header row.
    const model = screen.getByRole('button', { name: T.modelForChat })
    expect(picker().compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await user.click(picker())
    const items = await screen.findAllByRole('menuitemradio')
    expect(items.map((i) => i.textContent)).toEqual(['Assistant', 'Researcher'])
    expect(items[0]).toHaveAttribute('aria-checked', 'true')
  })

  test('test switching agent starts a new chat with that agent', async () => {
    const { user } = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'One{Enter}')
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Hello')).toBeInTheDocument()
    await user.click(picker())
    await user.click(await screen.findByRole('menuitemradio', { name: 'Researcher' }))
    expect(picker()).toHaveTextContent('Researcher')
    expect(screen.queryByText('Hello')).toBeNull()
    expect(aiEntry()?.target).toEqual({ kind: 'aiChat', agentId: RESEARCHER })
    await user.type(input(), 'Two{Enter}')
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(2))
    expect(mocked.aiChat.mock.calls[1][0]).toMatchObject({ agentId: RESEARCHER, chatId: null, sessionId: null, history: [] })
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(2))
    // A new AI Chat object, not the first chat's.
    expect(mocked.saveAiChat.mock.calls[1][0]).toMatchObject({ path: null, agentId: RESEARCHER })
  })

  test('test turns send agentId and the chatId from the chat event', async () => {
    mocked.aiChat.mockImplementation(answer({ type: 'chat', chatId: CHAT_ID, agentId: 'assistant' }, { type: 'text', text: 'Hi' }, done('Hi')))
    const { user } = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'One{Enter}')
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(1))
    expect(mocked.aiChat.mock.calls[0][0]).toMatchObject({ agentId: 'assistant', chatId: null })
    expect(mocked.saveAiChat.mock.calls[0][0]).toMatchObject({ agentId: 'assistant', chatId: CHAT_ID })
    await user.type(input(), 'Two{Enter}')
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(2))
    expect(mocked.aiChat.mock.calls[1][0]).toMatchObject({ agentId: 'assistant', chatId: CHAT_ID })
    // New chat forgets the transcript.
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: T.newChat }))
    await user.type(input(), 'Three{Enter}')
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(3))
    expect(mocked.aiChat.mock.calls[2][0]).toMatchObject({ agentId: 'assistant', chatId: null })
  })

  test('test Ctrl+Alt+J seed opens the default agent', async () => {
    // "Open AI chat" (Ctrl+Alt+J) opens the entry with no agent: the default agent's chat.
    s().open({ kind: 'object', path: 'Pages/A.md' })
    act(() => revealAiChat())
    const user = userEvent.setup()
    render(<Harness />)
    expect(picker()).toHaveTextContent('Assistant')
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'Hi{Enter}')
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(1))
    expect(mocked.aiChat.mock.calls[0][0]).toMatchObject({ agentId: 'assistant' })
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(1))

    // A seed without agentId moves even a Researcher chat to the default agent.
    await user.click(picker())
    await user.click(await screen.findByRole('menuitemradio', { name: 'Researcher' }))
    expect(picker()).toHaveTextContent('Researcher')
    act(() => openAiChat({ mode: 'chat', prompt: 'From a seed' }))
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(2))
    expect(mocked.aiChat.mock.calls[1][0]).toMatchObject({ agentId: 'assistant', prompt: 'From a seed', chatId: null })
    expect(picker()).toHaveTextContent('Assistant')
    expect(aiEntry()?.target).not.toHaveProperty('agentId')
  })

  test("test an editor entry's proposal still waits for Accept", async () => {
    mocked.object.mockResolvedValue(objectDetail({ summary: objectSummary({ path: 'Pages/A.md', tags: [] }), version: 'v2' }))
    mocked.aiChat.mockImplementation(answer(done('Try these.', { proposal: { kind: 'tags', tags: ['runbook'] } })))
    const onReplace = vi.fn()
    const { user } = setup({ agentId: RESEARCHER })
    act(() => openAiChat({ mode: 'tagBlock', block: 'Some text', blockPath: 'Pages/A.md', onReplace }))
    const box = await screen.findByRole('region', { name: T.proposedTags })
    expect(mocked.aiChat.mock.calls[0][0]).toMatchObject({ mode: 'tagBlock', agentId: 'assistant' })
    // Nothing is written before Accept.
    expect(mocked.updateProperties).not.toHaveBeenCalled()
    await user.click(within(box).getByRole('button', { name: T.accept }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Pages/A.md', { tags: ['runbook'] }, 'v2'))
  })

  test('test a transcript target shows its messages and tool steps', async () => {
    mocked.agentChat.mockResolvedValue(
      agentTranscript({
        id: CHAT_ID,
        agentId: RESEARCHER,
        sessionId: 'sess-r',
        items: [
          { type: 'user', text: 'Find rack', at: '2026-11-05T09:00:00.000Z', contextPaths: ['Pages/B.md'] },
          { type: 'tool', id: 't1', name: 'search', input: { query: 'rack' }, result: '[]', isError: false, at: '2026-11-05T09:00:01.000Z' },
          { type: 'assistant', text: 'Nothing found.', at: '2026-11-05T09:00:02.000Z', model: 'sonnet', sessionId: 'sess-r' },
          { type: 'user', text: 'Try again', at: '2026-11-05T09:01:00.000Z', contextPaths: ['Pages/B.md'] },
          { type: 'error', message: 'Claude Code stopped.', at: '2026-11-05T09:01:01.000Z' },
        ],
      }),
    )
    const { user } = setup({ agentId: RESEARCHER, chatId: CHAT_ID })
    const list = screen.getByRole('list', { name: T.title })
    expect(await within(list).findByText('Nothing found.')).toBeInTheDocument()
    expect(mocked.agentChat).toHaveBeenCalledWith(RESEARCHER, CHAT_ID)
    expect(within(list).getByText('Find rack')).toBeInTheDocument()
    expect(within(list).getByText('Try again')).toBeInTheDocument()
    const reply = list.querySelector('[data-role="assistant"]') as HTMLElement
    const step = within(reply).getByRole('button', { name: "Searched notes for 'rack'" })
    expect(step.compareDocumentPosition(within(reply).getByText('Nothing found.')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(screen.getByRole('list', { name: T.context })).getByText('Beta')).toBeInTheDocument()
    expect(picker()).toHaveTextContent('Researcher')

    // The next turn continues that transcript and session with its agent.
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'More{Enter}')
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(1))
    expect(mocked.aiChat.mock.calls[0][0]).toMatchObject({ agentId: RESEARCHER, chatId: CHAT_ID, sessionId: 'sess-r' })
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(1))
    expect(mocked.saveAiChat.mock.calls[0][0]).toMatchObject({ agentId: RESEARCHER, chatId: CHAT_ID })
    // Loaded once: the panel's own target changes don't load it again.
    expect(mocked.agentChat).toHaveBeenCalledTimes(1)
  })

  test('test a transcript saved as an AI Chat object saves to that object', async () => {
    mocked.agentChat.mockResolvedValue(agentTranscript({ id: CHAT_ID, agentId: RESEARCHER, objectPath: 'AI Chats/Rack.md' }))
    mocked.aiChatLoad.mockResolvedValue({
      path: 'AI Chats/Rack.md',
      version: 'v9',
      title: 'Rack',
      contextPaths: [],
      sessionId: 's1',
      messages: [],
      agent: 'Researcher',
      agentId: RESEARCHER,
      chatId: CHAT_ID,
    })
    const { user } = setup({ agentId: RESEARCHER, chatId: CHAT_ID })
    await waitFor(() => expect(mocked.aiChatLoad).toHaveBeenCalledWith('AI Chats/Rack.md'))
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'More{Enter}')
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(1))
    expect(mocked.saveAiChat.mock.calls[0][0]).toMatchObject({ path: 'AI Chats/Rack.md', baseVersion: 'v9', chatId: CHAT_ID })
  })

  test('test a saved M10 chat continues with the default agent', async () => {
    mocked.aiChatLoad.mockResolvedValue({
      path: 'AI Chats/Old.md',
      version: 'v3',
      title: 'Old',
      contextPaths: [],
      sessionId: 'sess-old',
      agent: null,
      agentId: 'assistant',
      chatId: null,
      messages: [
        { role: 'user', text: 'Earlier question', at: '2026-11-05T10:00:00Z' },
        { role: 'assistant', text: 'Earlier answer', at: '2026-11-05T10:00:01Z' },
      ],
    })
    const { user } = setup({ path: 'AI Chats/Old.md' })
    expect(await screen.findByText('Earlier answer')).toBeInTheDocument()
    expect(picker()).toHaveTextContent('Assistant')
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await user.type(input(), 'Next{Enter}')
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalled())
    expect(mocked.aiChat.mock.calls[0][0]).toMatchObject({ agentId: 'assistant', chatId: null, sessionId: 'sess-old' })
    expect(mocked.saveAiChat.mock.calls[0][0]).toMatchObject({ path: 'AI Chats/Old.md', baseVersion: 'v3', agentId: 'assistant' })
  })

  test("test the model default label is the agent's model", async () => {
    const { user } = setup({ agentId: RESEARCHER })
    const trigger = screen.getByRole('button', { name: T.modelForChat })
    // No pick: the trigger still says Default.
    expect(trigger).toHaveTextContent(/^Default$/)
    await user.click(trigger)
    expect(await screen.findByRole('option', { name: 'Default (Opus 5.5)' })).toHaveAttribute('aria-selected', 'true')
  })

  test('test hidden: nothing shows and the entry closes', async () => {
    setup()
    expect(screen.getByRole('textbox', { name: T.inputLabel })).toBeInTheDocument()
    act(() => useSettings.setState({ settings: { ...settingsDefaults, aiHidden: true } }))
    expect(screen.queryByRole('textbox', { name: T.inputLabel })).toBeNull()
    expect(aiEntry()).toBeUndefined()
  })

  // ---- M18: the Learning line and Learn from this chat ----

  /** The panel's change listeners, and an `agentLearning` event to them. */
  function learningEvents() {
    const listeners = new Set<(e: ChangeEvent) => void>()
    mocked.onChange.mockImplementation((cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    })
    return async (agentId = 'assistant') => {
      await act(async () => {
        for (const cb of [...listeners]) cb({ kind: 'agentLearning', path: agentId, version: 'r1', origin: null })
      })
    }
  }

  /** One turn of a chat that has a transcript id, answered "Hello". */
  async function oneTurn() {
    mocked.aiChat.mockImplementation(answer({ type: 'chat', chatId: CHAT_ID, agentId: 'assistant' }, { type: 'text', text: 'Hello' }, done('Hello')))
    const view = setup()
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalled())
    await view.user.type(input(), 'Hi{Enter}')
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocked.chatReviews).toHaveBeenCalledWith('assistant', CHAT_ID))
    return view
  }

  const later = () => new Date(Date.now() + 10).toISOString()

  test('test a running review shows Learning… after the reply', async () => {
    const emit = learningEvents()
    await oneTurn()
    mocked.chatReviews.mockResolvedValue([reviewStatus({ id: 'rv1', chatId: CHAT_ID, state: 'running', startedAt: later(), endedAt: null, summary: null })])
    await emit()
    const list = screen.getByRole('list', { name: T.title })
    const line = await within(list).findByText(LEARNING_LINE_TEXT.running)
    const reply = list.querySelector('[data-role="assistant"]') as HTMLElement
    const row = line.closest('[data-role="learning"]') as HTMLElement
    expect(row).not.toBeNull()
    expect(reply.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(row.querySelector('[data-icon="ph-spinner-gap"]')).not.toBeNull()
    expect(row.querySelector('.text-xs.text-fg-muted')).not.toBeNull()
    // Another agent's event doesn't reload.
    const calls = mocked.chatReviews.mock.calls.length
    await emit(RESEARCHER)
    expect(mocked.chatReviews).toHaveBeenCalledTimes(calls)
  })

  test('test the done line shows the summary and opens the skills tab with the entries focused', async () => {
    const emit = learningEvents()
    const { user } = await oneTurn()
    mocked.chatReviews.mockResolvedValue([reviewStatus({ id: 'rv1', chatId: CHAT_ID, startedAt: later(), entryIds: ['e1', 'e2'] })])
    await emit()
    const button = await screen.findByRole('button', { name: 'Saved 1 memory, updated 1 skill' })
    await user.click(button)
    expect(useLearningFocus.getState()).toMatchObject({ agentId: 'assistant', entryIds: ['e1', 'e2'] })
    expect(currentTarget(s())).toEqual({ kind: 'agent', id: 'assistant', tab: 'skills' })
  })

  test('test a memory-only summary opens the memory tab', async () => {
    const emit = learningEvents()
    const { user } = await oneTurn()
    mocked.chatReviews.mockResolvedValue([
      reviewStatus({ id: 'rv1', chatId: CHAT_ID, startedAt: later(), summary: 'Saved 2 memories', entryIds: ['e1', 'e2'] }),
    ])
    await emit()
    await user.click(await screen.findByRole('button', { name: 'Saved 2 memories' }))
    expect(currentTarget(s())).toEqual({ kind: 'agent', id: 'assistant', tab: 'memory' })
    expect(useLearningFocus.getState().entryIds).toEqual(['e1', 'e2'])
  })

  test('test nothing learned and a failed review are plain lines', async () => {
    const emit = learningEvents()
    await oneTurn()
    mocked.chatReviews.mockResolvedValue([
      reviewStatus({ id: 'rv1', chatId: CHAT_ID, startedAt: later(), summary: 'Nothing new to learn', entryIds: [] }),
      reviewStatus({ id: 'rv2', chatId: CHAT_ID, startedAt: later(), state: 'failed', summary: null, message: 'Claude Code stopped.' }),
    ])
    await emit()
    expect(await screen.findByText(LEARNING_LINE_TEXT.nothing)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: LEARNING_LINE_TEXT.nothing })).toBeNull()
    expect(screen.getByText('Learning stopped: Claude Code stopped.')).toBeInTheDocument()
  })

  test('test the input stays enabled while learning', async () => {
    const emit = learningEvents()
    const { user } = await oneTurn()
    mocked.chatReviews.mockResolvedValue([reviewStatus({ id: 'rv1', chatId: CHAT_ID, state: 'running', startedAt: later(), summary: null })])
    await emit()
    await screen.findByText(LEARNING_LINE_TEXT.running)
    expect(input()).toBeEnabled()
    // Past the line's slack, so the next reply is clearly later than the review's start.
    await new Promise((r) => setTimeout(r, 1100))
    await user.type(input(), 'Next{Enter}')
    await waitFor(() => expect(mocked.aiChat).toHaveBeenCalledTimes(2))
    expect(mocked.aiChat.mock.calls[1][0]).toMatchObject({ prompt: 'Next', chatId: CHAT_ID })
    // The line stays after the first reply, not the new one.
    await waitFor(() => expect(mocked.saveAiChat).toHaveBeenCalledTimes(2))
    const list = screen.getByRole('list', { name: T.title })
    const replies = list.querySelectorAll('[data-role="assistant"]')
    const row = list.querySelector('[data-role="learning"]') as HTMLElement
    expect(replies[0].compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(replies[1].compareDocumentPosition(row) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  test('test Learn from this chat calls the route and shows a 409 as a notice', async () => {
    const { user } = await oneTurn()
    mocked.learnFromChat.mockResolvedValueOnce(reviewStatus({ id: 'rv1', chatId: CHAT_ID, state: 'running', trigger: 'manual' }))
    await user.click(screen.getByRole('button', { name: CHAT_MENU_TEXT.more }))
    await user.click(await screen.findByRole('menuitem', { name: CHAT_MENU_TEXT.learn }))
    expect(mocked.learnFromChat).toHaveBeenCalledWith('assistant', CHAT_ID)
    mocked.learnFromChat.mockRejectedValueOnce(new ApiError(409, 'This chat is already being reviewed.'))
    await user.click(screen.getByRole('button', { name: CHAT_MENU_TEXT.more }))
    await user.click(await screen.findByRole('menuitem', { name: CHAT_MENU_TEXT.learn }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This chat is already being reviewed.')
  })

  test('test Learn from this chat is disabled before the first reply', async () => {
    const { user } = setup()
    // The menu sits after New chat in the header.
    const more = screen.getByRole('button', { name: CHAT_MENU_TEXT.more })
    expect(screen.getByRole('button', { name: T.newChat }).compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await user.click(more)
    const item = await screen.findByRole('menuitem', { name: CHAT_MENU_TEXT.learn })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(mocked.learnFromChat).not.toHaveBeenCalled()
  })

  test('test Learn from this chat is disabled while a review of it runs', async () => {
    const emit = learningEvents()
    const { user } = await oneTurn()
    mocked.chatReviews.mockResolvedValue([reviewStatus({ id: 'rv1', chatId: CHAT_ID, state: 'running', startedAt: later(), summary: null })])
    await emit()
    await screen.findByText(LEARNING_LINE_TEXT.running)
    await user.click(screen.getByRole('button', { name: CHAT_MENU_TEXT.more }))
    expect(await screen.findByRole('menuitem', { name: CHAT_MENU_TEXT.learn })).toHaveAttribute('aria-disabled', 'true')
  })

  test("test a transcript's learning items show as lines", async () => {
    mocked.agentChat.mockResolvedValue(
      agentTranscript({
        id: CHAT_ID,
        agentId: RESEARCHER,
        sessionId: 'sess-r',
        items: [
          { type: 'user', text: 'Remember I like short answers', at: '2026-11-05T09:00:00.000Z', contextPaths: [] },
          { type: 'assistant', text: 'Noted.', at: '2026-11-05T09:00:02.000Z', model: 'sonnet', sessionId: 'sess-r' },
          { type: 'learning', reviewId: 'rv1', kinds: ['memory'], state: 'done', summary: 'Saved 1 memory', message: null, at: '2026-11-05T09:00:03.000Z' },
          { type: 'user', text: 'Thanks', at: '2026-11-05T09:01:00.000Z', contextPaths: [] },
          { type: 'assistant', text: 'Any time.', at: '2026-11-05T09:01:02.000Z', model: 'sonnet', sessionId: 'sess-r' },
        ],
      }),
    )
    setup({ agentId: RESEARCHER, chatId: CHAT_ID })
    const list = screen.getByRole('list', { name: T.title })
    const line = await within(list).findByText('Saved 1 memory')
    const row = line.closest('[data-role="learning"]') as HTMLElement
    const replies = list.querySelectorAll('[data-role="assistant"]')
    expect(replies[0].compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(replies[1].compareDocumentPosition(row) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    await waitFor(() => expect(mocked.chatReviews).toHaveBeenCalledWith(RESEARCHER, CHAT_ID))
  })

  test('test Copy leaves out the learning line', async () => {
    const emit = learningEvents()
    const { user } = await oneTurn()
    mocked.chatReviews.mockResolvedValue([reviewStatus({ id: 'rv1', chatId: CHAT_ID, startedAt: later(), entryIds: ['e1'] })])
    await emit()
    await screen.findByRole('button', { name: 'Saved 1 memory, updated 1 skill' })
    const write = vi.spyOn(navigator.clipboard, 'writeText')
    await user.click(screen.getByRole('button', { name: T.copy }))
    expect(write).toHaveBeenCalledWith('Hello')
    // The saved AI Chat holds the messages only.
    const saved = mocked.saveAiChat.mock.calls[0][0].messages
    expect(saved.map((m) => m.text)).toEqual(['Hi', 'Hello'])
  })
})
