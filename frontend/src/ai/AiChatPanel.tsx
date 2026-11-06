/**
 * M10: the AI chat, shown by the `{kind: 'aiChat', path?}` side-panel entry. The catalog names only
 * the entry points, so the whole layout is **our choice**: a header ("New chat"), the context
 * chips (default: the tab's open object), the messages, the input, and "Relevant Content" for the
 * first context page under it.
 *
 * - A turn streams from `api.aiChat` (the server runs Claude Code; this window never calls out).
 *   While it runs the panel shows "Thinking…" or the tool in use ("Searching your notes…"); Stop
 *   aborts it (our choice: the partial answer stays, unsaved).
 * - M16: messages render as Markdown (`ChatMarkdown`, inert); an answer's tool calls show as
 *   collapsed steps between its texts (`ToolStep`, not saved). `text` stays the Markdown source,
 *   and Copy, the appends, Rephrase and the save use it. The header (`AiChatHeader`) holds this
 *   chat's model pick (panel state only: New chat and loading a saved chat go back to Default).
 * - Nothing is written without a click: a proposal (tags, properties, text) shows Accept/Dismiss
 *   (or Replace/Insert below/Copy for text); "Append to page" and "Append to daily note" write
 *   through the normal object calls (`aiWrites.ts`).
 * - Seeds (`openAiChat(seed)`): each one starts a new chat (our choice) with its context and block;
 *   it is sent at once when it has a prompt or its mode isn't `chat`, once Claude Code answers and
 *   the first-use notice has been acknowledged.
 * - Saving: after each completed turn the chat is saved as an AI Chat object (created on the first
 *   save, with its title; then by version, without one, so a rename elsewhere stays). A 409 reloads
 *   it: when the saved messages are the start of the panel's, the panel's are saved over them;
 *   otherwise nothing is saved and a note says the chat changed elsewhere (our choice: the edits
 *   made elsewhere are never overwritten). The entry then names its path, so a reload shows the
 *   same chat. The CLI session id is kept for `--resume`.
 * - A proposal is accepted into the page that was first in the context when its turn was sent.
 * - A block or selection goes with the object it came from (`blockPath`); the server refuses one
 *   from a page excluded from AI or a template.
 * - Keys (while focus is inside the panel; catalog section 2): copy message Ctrl+Alt+C, append
 *   message Ctrl+Alt+A, retry Ctrl+Alt+R, close chat Ctrl+Alt+X, rephrase Ctrl+Alt+U, each on the
 *   last answer. In the message box, a Ctrl+Alt (AltGr on Windows) character that isn't a Latin
 *   letter is typed, not taken as a shortcut ("ą" is AltGr+A on a Polish keyboard).
 * - "Hide AI features" on: the panel shows nothing and closes its entry.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { api, ConflictError } from '@/api/client'
import type { AiEvent, AiMessage, AiMode, AiProposal, AiSkipped, AiStatus, ObjectSummary } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { showToast } from '@/editor/media/upload'
import { cn } from '@/lib/utils'
import { keysFor, matches } from '@/lib/shortcuts'
import { ensureLinkIndex, stemOf, typeOf, useLinkIndex } from '@/links/linkIndex'
import { currentTarget, useTabs } from '@/nav/tabs'
import { usePalette } from '@/palette/usePalette'
import { PASTE_TEXT } from '@/palette/paste'
import { EntryHeader } from '@/references/BacklinksTab'
import { useReferences } from '@/references/useReferences'
import { useSettings } from '@/settings/useSettings'
import { useSettingsModal } from '@/settings/useSettingsModal'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { AiChatHeader } from './AiChatHeader'
import { AI_CHAT_TEXT as T, MODE_LABELS, toolLine } from './aiText'
import { addTags, appendToObject, appendToTodaysNote, setProperties } from './aiWrites'
import { ChatMarkdown } from './ChatMarkdown'
import { ToolStep } from './ToolStep'
import { applyEvent, stopSteps, type ChatPart } from './toolSteps'
import { noticeSeen, rememberNotice, useAiFocus } from './reveal'
import { useAi, useAiHidden, type AiSeed } from './store'

/** One message as the panel keeps it: the saved fields plus what it needs to retry or apply. */
export interface ChatItem extends AiMessage {
  id: string
  /** A user turn: what was sent (to retry it). */
  prompt?: string
  mode?: AiMode
  block?: string | null
  blockPath?: string | null
  /** An assistant turn: its proposal, the page it is for, the pages left out, and what became of the proposal. */
  proposal?: AiProposal | null
  /** The first context page when the turn was sent: where an accepted proposal is written. */
  target?: string | null
  skipped?: AiSkipped[]
  proposalState?: 'accepted' | 'dismissed'
  stopped?: boolean
  /** M16: an assistant turn of this panel: its texts and tool steps in stream order (not saved). */
  parts?: ChatPart[]
}

interface Turn {
  prompt: string
  mode: AiMode
  block: string | null
  /** The object `block` came from (none: an answer of this chat). */
  blockPath?: string | null
  /** The messages before this turn (default: all of them). */
  base?: ChatItem[]
  /** Start a fresh CLI session (a retry), so the history drives it. */
  fresh?: boolean
}

let itemSeq = 0
const newItemId = () => `m${Date.now().toString(36)}${(++itemSeq).toString(36)}`

const toItem = (m: AiMessage): ChatItem => ({ ...m, id: newItemId() })
const toMessage = (i: ChatItem): AiMessage => ({ role: i.role, text: i.text, at: i.at })

const sameMessage = (a: AiMessage, b: AiMessage) => a.role === b.role && (a.at ?? '') === (b.at ?? '') && a.text.trim() === b.text.trim()

/** Whether `saved` is the start of `local` (the same messages, maybe fewer). */
function isPrefix(saved: AiMessage[], local: AiMessage[]): boolean {
  return saved.length <= local.length && saved.every((m, i) => sameMessage(m, local[i]))
}

/** A Ctrl+Alt character typed in a text box (AltGr on Windows): text, not a shortcut. */
function isAltGrText(e: KeyboardEvent): boolean {
  if (!e.ctrlKey || !e.altKey || e.metaKey) return false
  const t = e.target
  if (!(t instanceof HTMLElement) || !t.closest('textarea, input')) return false
  return [...e.key].length === 1 && !/^[a-z]$/i.test(e.key)
}

/** The saved chat's title: the first thing asked, on one line (our choice). */
function chatTitle(items: ChatItem[]): string {
  const first = items.find((i) => i.role === 'user')
  const line = (first?.text ?? '').split(/\r?\n/).find((l) => l.trim())?.trim() ?? ''
  if (!line) return T.title
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line
}

const hasSteps = (parts: ChatPart[] | undefined): parts is ChatPart[] => !!parts?.some((p) => p.kind === 'tool')

/** An assistant turn's body: its parts in order when it had tool steps, else its Markdown. */
function AssistantBody({ text, parts, streaming }: { text: string; parts?: ChatPart[]; streaming?: boolean }) {
  if (!hasSteps(parts)) return text ? <ChatMarkdown source={text} streaming={streaming} className="text-[14px] break-words text-fg" /> : null
  return (
    <div className="flex flex-col">
      {parts.map((p, i) =>
        p.kind === 'tool' ? (
          <ToolStep key={p.step.id} step={p.step} />
        ) : (
          <ChatMarkdown key={`t${i}`} source={p.text} streaming={streaming} className="text-[14px] break-words text-fg" />
        ),
      )}
    </div>
  )
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function isAbort(e: unknown): boolean {
  return (e instanceof DOMException && e.name === 'AbortError') || (e instanceof Error && e.name === 'AbortError')
}

function useTitleOf(): (path: string) => string {
  const objects = useLinkIndex((s) => s.objects)
  const byPath = useMemo(() => new Map(objects.map((o) => [o.path, o])), [objects])
  return useCallback((path: string) => byPath.get(path)?.title || stemOf(path), [byPath])
}

function formatValue(v: unknown): string {
  if (v == null) return ''
  if (Array.isArray(v)) return v.map(formatValue).join(', ')
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.start === 'string') return o.start
    if (typeof o.target === 'string') return o.target
    return JSON.stringify(v)
  }
  return String(v)
}

function copyText(text: string): void {
  void Promise.resolve(navigator.clipboard?.writeText(text))
    .then(() => showToast(T.copied))
    .catch(() => undefined)
}

// ---- small parts ----

function IconButton({
  label,
  icon,
  onClick,
  disabled,
  title,
}: {
  label: string
  icon: string
  onClick(): void
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <Icon name={icon} size={15} />
    </button>
  )
}

function TextButton({ children, onClick, disabled, title, primary }: { children: string; onClick(): void; disabled?: boolean; title?: string; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex h-7 items-center rounded-md border px-2.5 text-[13px] font-medium disabled:opacity-50',
        primary ? 'border-fg-muted bg-raised text-fg hover:bg-hover' : 'border-line text-fg hover:bg-hover',
      )}
    >
      {children}
    </button>
  )
}

/** "Add a page to the context": a search over the space's objects (our picker, as Settings > Editor's). */
function AddContext({ onPick, exclude }: { onPick(path: string): void; exclude: string[] }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const objects = useLinkIndex((s) => s.objects)
  useEffect(() => {
    if (open) void ensureLinkIndex()
  }, [open])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return objects.filter((o) => !exclude.includes(o.path) && (!needle || o.title.toLowerCase().includes(needle))).slice(0, 50)
  }, [objects, q, exclude])
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQ('')
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={T.addContext}
          title={T.addContext}
          className="flex size-6 items-center justify-center rounded-md border border-dashed border-line text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Icon name="ph-plus" size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] border-line bg-raised p-2 text-fg">
        <input
          autoFocus
          aria-label={T.pickPage}
          placeholder={T.pickPage}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mb-1 h-8 w-full rounded-md border border-line bg-transparent px-2 text-[14px] outline-none focus:border-fg-muted"
        />
        <ul role="listbox" aria-label={T.pickPage} className="max-h-[240px] overflow-y-auto">
          {shown.map((o) => (
            <li key={o.path}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onPick(o.path)
                  setOpen(false)
                  setQ('')
                }}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[14px] hover:bg-hover"
              >
                <span className="truncate">{o.title}</span>
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-2 py-1.5 text-[13px] text-fg-muted">{T.noPages}</li>}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/** "Relevant Content": the related objects of `path` (the references call), and "Find More". */
function RelevantContent({ path }: { path: string | null }) {
  return (
    <section aria-label={T.relevant} className="shrink-0 border-t border-line px-3 py-2">
      <div className="flex items-center gap-2 pb-1">
        <h3 className="min-w-0 flex-1 text-[13px] font-semibold text-fg-muted">{T.relevant}</h3>
        <button
          type="button"
          onClick={() => usePalette.getState().show('search')}
          className="rounded-md px-2 py-0.5 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
        >
          {T.findMore}
        </button>
      </div>
      {path ? <RelatedList path={path} /> : <p className="px-1 pb-1 text-[13px] text-fg-muted">{T.relevantNone}</p>}
    </section>
  )
}

const RELATED_LIMIT = 6

function RelatedList({ path }: { path: string }) {
  const { data, loading } = useReferences(path, RELATED_LIMIT)
  const entries = data?.related ?? []
  const summaries: Record<string, ObjectSummary> = data?.summaries ?? {}
  if (!data) return loading ? null : <p className="px-1 pb-1 text-[13px] text-fg-muted">{T.relevantEmpty}</p>
  if (entries.length === 0) return <p className="px-1 pb-1 text-[13px] text-fg-muted">{T.relevantEmpty}</p>
  const list = entries.map((e) => e.path)
  return (
    <ul className="flex max-h-[180px] flex-col gap-0.5 overflow-y-auto" data-references-list="ai-related">
      {entries.slice(0, RELATED_LIMIT).map((e) => (
        <li key={e.path}>
          <EntryHeader path={e.path} summary={summaries[e.path]} list={list} />
        </li>
      ))}
    </ul>
  )
}

function StatusExplanation({ status }: { status: AiStatus | null }) {
  if (!status) return <p className="px-3 py-3 text-[13px] text-fg-muted">{T.checking}</p>
  const title = status.reason === 'notFound' ? T.notFound : status.message || (status.reason === 'notSignedIn' ? T.notSignedIn : T.notFound)
  return (
    <div role="alert" className="mx-3 my-3 flex flex-col gap-1 rounded-lg border border-line bg-raised p-3 text-[13px]">
      <p className="font-semibold text-fg">{title}</p>
      {status.reason === 'notFound' && <p className="text-fg-muted">{T.notFoundHelp}</p>}
      <div className="pt-1">
        <TextButton onClick={() => useSettingsModal.getState().open('aiAssistant')}>{T.openSettings}</TextButton>
      </div>
    </div>
  )
}

// ---- the panel ----

export interface AiChatPanelProps {
  /** The side-panel entry showing the chat. */
  entryId: string
  /** The saved AI Chat object it shows (none: a new chat). */
  path?: string
}

export function AiChatPanel(props: AiChatPanelProps) {
  const hidden = useAiHidden()
  const { entryId } = props
  useEffect(() => {
    if (hidden) useTabs.getState().closeSidepanelEntry(entryId)
  }, [hidden, entryId])
  if (hidden) return null
  return <AiChat {...props} />
}

function AiChat({ entryId, path }: AiChatPanelProps) {
  const main = useTabs((s) => currentTarget(s))
  const mainPath = main?.kind === 'object' ? main.path : null
  const root = useSpaceInfo((s) => s.space?.root ?? null)
  const titleOf = useTitleOf()

  const [items, setItemsState] = useState<ChatItem[]>([])
  const itemsRef = useRef<ChatItem[]>([])
  const setItems = useCallback((next: ChatItem[] | ((prev: ChatItem[]) => ChatItem[])) => {
    const value = typeof next === 'function' ? next(itemsRef.current) : next
    itemsRef.current = value
    setItemsState(value)
  }, [])

  const [context, setContextState] = useState<string[]>(() => (mainPath ? [mainPath] : []))
  const contextRef = useRef(context)
  const setContext = (next: string[]) => {
    contextRef.current = next
    setContextState(next)
  }
  /** The user (or a seed, or a loaded chat) chose the context: it stops following the main view. */
  const contextChosen = useRef(false)
  const [block, setBlock] = useState<string | null>(null)
  const [blockPath, setBlockPath] = useState<string | null>(null)
  const callbacks = useRef<Pick<AiSeed, 'onReplace' | 'onInsertBelow' | 'release'>>({})
  const [canReplace, setCanReplace] = useState(false)
  const [canInsert, setCanInsert] = useState(false)

  const [status, setStatus] = useState<AiStatus | null>(null)
  const [acked, setAcked] = useState(false)
  const showNotice = !acked && !noticeSeen(root)

  const [busy, setBusy] = useState<{ text: string; tools: string[]; parts: ChatPart[] } | null>(null)
  /** This chat's model pick (null: Default); a ref too, for the turn being sent. */
  const [model, setModelState] = useState<string | null>(null)
  const modelRef = useRef<string | null>(null)
  const setModel = useCallback((next: string | null) => {
    modelRef.current = next
    setModelState(next)
  }, [])
  const defaultModel = useSettings((st) => st.settings.aiModel ?? null)
  const controller = useRef<AbortController | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [queued, setQueued] = useState<Turn | null>(null)
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listEnd = useRef<HTMLDivElement>(null)

  const chat = useRef<{ path: string | null; version: string | null }>({ path: null, version: null })
  const sessionId = useRef<string | null>(null)
  const loadSeq = useRef(0)
  /** A saved chat a seed replaced: not loaded when the entry still names it. */
  const ignorePath = useRef<string | null>(null)
  const saving = useRef<Promise<void>>(Promise.resolve())
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    void useSpaceInfo.getState().ensure()
    void ensureLinkIndex()
    let live = true
    api
      .aiStatus()
      .then((s) => {
        if (live) setStatus(s)
      })
      .catch((e: unknown) => {
        if (live) setStatus({ available: false, reason: 'error', claudePath: null, version: null, message: errorText(e) })
      })
    return () => {
      live = false
      alive.current = false
      controller.current?.abort()
      // The chat closed: the editor stops tracking its seed's range (not on a remount, as Strict Mode's).
      const held = callbacks.current
      setTimeout(() => {
        if (!alive.current) held.release?.()
      }, 0)
    }
  }, [])

  // A new chat follows the main view's object until a context is chosen.
  useEffect(() => {
    if (contextChosen.current || itemsRef.current.length > 0) return
    setContext(mainPath ? [mainPath] : [])
  }, [mainPath])

  const focusInput = () => requestAnimationFrame(() => inputRef.current?.focus())

  const reset = useCallback(() => {
    controller.current?.abort()
    controller.current = null
    loadSeq.current++
    chat.current = { path: null, version: null }
    sessionId.current = null
    setModel(null)
    setItems([])
    setBusy(null)
    setError(null)
    setSaveError(null)
    setQueued(null)
    setBlock(null)
    setBlockPath(null)
    callbacks.current.release?.()
    callbacks.current = {}
    setCanReplace(false)
    setCanInsert(false)
  }, [setItems, setModel])

  // Seeds from `openAiChat`: each one starts a new chat.
  const pendingN = useAi((s) => s.pending?.n ?? 0)
  useEffect(() => {
    const seed = useAi.getState().take()
    if (!seed) return
    reset()
    if (path) {
      // The entry named a saved chat: the new one replaces it (and that chat is not loaded).
      ignorePath.current = path
      useTabs.getState().replaceSidepanelEntryTarget(entryId, { kind: 'aiChat' })
    }
    contextChosen.current = true
    const current = currentTarget(useTabs.getState())
    const fallback = current?.kind === 'object' ? [current.path] : []
    setContext(seed.contextPaths ?? fallback)
    setBlock(seed.block ?? null)
    setBlockPath(seed.blockPath ?? null)
    callbacks.current = { onReplace: seed.onReplace, onInsertBelow: seed.onInsertBelow, release: seed.release }
    setCanReplace(!!seed.onReplace)
    setCanInsert(!!seed.onInsertBelow)
    if (seed.prompt?.trim() || seed.mode !== 'chat')
      setQueued({ prompt: seed.prompt ?? '', mode: seed.mode, block: seed.block ?? null, blockPath: seed.blockPath ?? null })
    else focusInput()
    // `path` and `entryId` are read as they are when a seed arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingN, reset])

  // The saved chat named by the entry: loaded when it isn't the one shown.
  useEffect(() => {
    if (path && path === ignorePath.current) return
    ignorePath.current = null
    if (!path) {
      if (chat.current.path) reset()
      return
    }
    if (path === chat.current.path) return
    const mine = ++loadSeq.current
    api
      .aiChatLoad(path)
      .then((c) => {
        if (mine !== loadSeq.current || !alive.current) return
        chat.current = { path: c.path, version: c.version }
        sessionId.current = c.sessionId
        setModel(null)
        contextChosen.current = true
        setContext(c.contextPaths)
        setItems(c.messages.map(toItem))
      })
      .catch((e: unknown) => {
        if (mine === loadSeq.current && alive.current) setError(errorText(e))
      })
  }, [path, reset, setItems, setModel])

  const save = useCallback(() => {
    const run = async () => {
      const messages = itemsRef.current.filter((i) => !i.stopped).map(toMessage)
      const base = {
        // The title only when the chat is made: a saved chat keeps its own (a rename stays).
        ...(chat.current.path ? {} : { title: chatTitle(itemsRef.current) }),
        contextPaths: contextRef.current,
        sessionId: sessionId.current,
        messages,
      }
      const seq = loadSeq.current
      try {
        let res
        try {
          res = await api.saveAiChat({ ...base, path: chat.current.path, baseVersion: chat.current.version })
        } catch (e) {
          if (!(e instanceof ConflictError) || !chat.current.path) throw e
          const fresh = await api.aiChatLoad(chat.current.path)
          // Saved over only when nothing but this panel's own turns were added: else stop, and keep
          // what was changed elsewhere.
          if (!isPrefix(fresh.messages, messages)) {
            if (seq === loadSeq.current && alive.current) setSaveError(T.changedElsewhere)
            return
          }
          res = await api.saveAiChat({ ...base, path: chat.current.path, baseVersion: fresh.version })
        }
        // A "New chat" (or another chat) since: this save no longer names what is shown.
        if (seq !== loadSeq.current) return
        chat.current = { path: res.path, version: res.version }
        setSaveError(null)
        if (alive.current) useTabs.getState().replaceSidepanelEntryTarget(entryId, { kind: 'aiChat', path: res.path })
      } catch (e) {
        if (seq === loadSeq.current && alive.current) setSaveError(T.saveFailed(errorText(e)))
      }
    }
    saving.current = saving.current.then(run)
    return saving.current
  }, [entryId])

  const send = useCallback(
    async (turn: Turn) => {
      if (controller.current) return
      const base = turn.base ?? itemsRef.current
      const user: ChatItem = {
        id: newItemId(),
        role: 'user',
        text: turn.prompt.trim() || MODE_LABELS[turn.mode] || turn.prompt,
        at: new Date().toISOString(),
        prompt: turn.prompt,
        mode: turn.mode,
        block: turn.block,
        blockPath: turn.block ? (turn.blockPath ?? null) : null,
      }
      const target = contextRef.current[0] ?? null
      setItems([...base, user])
      setError(null)
      if (turn.fresh) sessionId.current = null
      const ctl = new AbortController()
      controller.current = ctl
      const seq = loadSeq.current
      let acc = ''
      let parts: ChatPart[] = []
      let done: Extract<AiEvent, { type: 'done' }> | null = null
      let failed: string | null = null
      setBusy({ text: '', tools: [], parts: [] })
      const onEvent = (e: AiEvent) => {
        if (ctl.signal.aborted) return
        if (e.type === 'session') sessionId.current = e.sessionId
        else if (e.type === 'text') {
          acc += e.text
          parts = applyEvent(parts, e)
          const now = parts
          setBusy((b) => ({ text: acc, tools: b?.tools ?? [], parts: now }))
        } else if (e.type === 'tool') {
          parts = applyEvent(parts, e)
          const now = parts
          const call = e.result === undefined
          setBusy((b) => ({ text: b?.text ?? acc, tools: call ? [...(b?.tools ?? []), e.name] : (b?.tools ?? []), parts: now }))
        } else if (e.type === 'done') done = e
        else if (e.type === 'error') failed = e.message
      }
      try {
        await api.aiChat(
          {
            mode: turn.mode,
            prompt: turn.prompt,
            contextPaths: contextRef.current,
            block: turn.block,
            blockPath: user.blockPath,
            history: base.map(toMessage),
            sessionId: sessionId.current,
            model: modelRef.current,
          },
          onEvent,
          ctl.signal,
        )
      } catch (e) {
        if (!isAbort(e)) failed = errorText(e)
      }
      if (controller.current === ctl) controller.current = null
      // A reset (New chat, another seed) or unmount since: nothing to show.
      if (seq !== loadSeq.current || !alive.current) return
      setBusy(null)
      const finished = done as Extract<AiEvent, { type: 'done' }> | null
      if (finished) {
        if (finished.sessionId) sessionId.current = finished.sessionId
        // With tool steps, `done.text` is only the last message: the item's text is every
        // streamed text (what the parts show), so Copy and the save hold what was displayed.
        // `finished.text` still gives the proposal (parsed by the backend from it).
        if (hasSteps(parts) && !acc && finished.text) parts = [...parts, { kind: 'text', text: finished.text }]
        const shown = hasSteps(parts) ? acc || finished.text : finished.text || acc
        setItems((prev) => [
          ...prev,
          {
            id: newItemId(),
            role: 'assistant',
            text: shown,
            at: new Date().toISOString(),
            proposal: finished.proposal,
            target,
            skipped: finished.skipped,
            // A step still pending when 'done' arrives never got its result: it shows as stopped.
            ...(hasSteps(parts) ? { parts: stopSteps(parts) } : {}),
          },
        ])
        void save()
        return
      }
      const partial = (): ChatItem => ({
        id: newItemId(),
        role: 'assistant',
        text: acc,
        at: new Date().toISOString(),
        stopped: true,
        ...(hasSteps(parts) ? { parts: stopSteps(parts) } : {}),
      })
      // A stopped or failed turn keeps what it showed: its text, or its steps when no text came yet.
      const keep = !!acc || hasSteps(parts)
      if (ctl.signal.aborted) {
        if (keep) setItems((prev) => [...prev, partial()])
        return
      }
      if (keep) setItems((prev) => [...prev, partial()])
      setError(failed ?? T.emptyAnswer)
    },
    [save, setItems],
  )

  const ready = !!status?.available && !showNotice

  // A queued turn (from a seed) goes once Claude Code answers and the notice is acknowledged.
  useEffect(() => {
    if (!queued || !ready || busy) return
    setQueued(null)
    void send(queued)
  }, [queued, ready, busy, send])

  // "Open AI chat" (and every reveal) moves focus to the input.
  const focusN = useAiFocus((s) => s.n)
  useEffect(() => {
    if (focusN > 0) focusInput()
  }, [focusN])

  useEffect(() => {
    listEnd.current?.scrollIntoView?.({ block: 'end' })
  }, [items, busy])

  // ---- actions ----

  const submit = () => {
    const text = input.trim()
    if (!text || !ready || controller.current) return
    setInput('')
    void send({ prompt: text, mode: 'chat', block, blockPath })
  }

  const stop = () => controller.current?.abort()

  const lastAssistant = [...items].reverse().find((i) => i.role === 'assistant')

  const retry = () => {
    if (!ready || controller.current) return
    const list = itemsRef.current
    let at = -1
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === 'user') {
        at = i
        break
      }
    }
    if (at < 0) return
    const u = list[at]
    void send({ prompt: u.prompt ?? u.text, mode: u.mode ?? 'chat', block: u.block ?? null, blockPath: u.blockPath ?? null, base: list.slice(0, at), fresh: true })
  }

  const rephrase = (item: ChatItem) => {
    if (!ready || controller.current) return
    // An answer of this chat, from no page: the server sends it as the history's own text.
    void send({ prompt: '', mode: 'rephrase', block: item.text, blockPath: null })
  }

  const firstPage = context[0] ?? null

  const appendToPage = (text: string) => {
    if (!firstPage) return
    appendToObject(firstPage, text)
      .then(() => showToast(T.appended))
      .catch((e: unknown) => setError(errorText(e)))
  }

  const appendToDaily = (text: string) => {
    appendToTodaysNote(text)
      .then(() => showToast(PASTE_TEXT.addedToDailyNote))
      .catch((e: unknown) => setError(errorText(e)))
  }

  const markProposal = (id: string, state: 'accepted' | 'dismissed') =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, proposalState: state } : i)))

  const accept = (item: ChatItem) => {
    const p = item.proposal
    const target = item.target
    if (!p || !target) return
    const write = p.kind === 'tags' ? addTags(target, p.tags) : p.kind === 'properties' ? setProperties(target, p.values) : null
    if (!write) return
    write.then(() => markProposal(item.id, 'accepted')).catch((e: unknown) => setError(errorText(e)))
  }

  const closeChat = () => useTabs.getState().closeSidepanelEntry(entryId)

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const ev = e.nativeEvent
    if (isAltGrText(ev)) return
    const hit = (id: string) => matches(ev, keysFor(id))
    let act: (() => void) | null = null
    if (hit('aiCloseChat')) act = closeChat
    else if (hit('aiRetry')) act = retry
    else if (lastAssistant && hit('aiCopyMessage')) act = () => copyText(lastAssistant.text)
    else if (lastAssistant && hit('aiAppendMessage')) act = () => appendToPage(lastAssistant.text)
    else if (lastAssistant && hit('aiRephrase')) act = () => rephrase(lastAssistant)
    if (!act) return
    e.preventDefault()
    e.stopPropagation()
    act()
  }

  const removeContext = (p: string) => {
    contextChosen.current = true
    setContext(contextRef.current.filter((x) => x !== p))
  }
  const addContext = (p: string) => {
    contextChosen.current = true
    if (!contextRef.current.includes(p)) setContext([...contextRef.current, p])
  }

  const newChat = () => {
    reset()
    contextChosen.current = false
    setContext(mainPath ? [mainPath] : [])
    if (path) useTabs.getState().replaceSidepanelEntryTarget(entryId, { kind: 'aiChat' })
    focusInput()
  }

  const propertyName = (key: string, page: string | null): string => {
    const typeId = page ? useLinkIndex.getState().objects.find((o) => o.path === page)?.type : undefined
    return typeOf(typeId)?.propertyDefinitions.find((d) => d.key === key)?.name ?? key
  }

  // ---- render ----

  const busyLine = busy ? (busy.tools.length ? toolLine(busy.tools[busy.tools.length - 1]) : T.thinking) : null

  return (
    <div data-ai-chat="" className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <AiChatHeader model={model} defaultModel={defaultModel} onModelChange={setModel} onNewChat={newChat} busy={!!busy} />
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-1.5">
        <span className="text-[12px] font-medium text-fg-muted">{T.context}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" aria-label={T.context} role="list">
          {context.map((p) => (
            <span key={p} role="listitem" className="inline-flex h-6 max-w-[200px] items-center gap-1 rounded-md border border-line bg-raised pr-0.5 pl-2 text-[12px]">
              <span className="truncate">{titleOf(p)}</span>
              <button
                type="button"
                aria-label={T.removeContext(titleOf(p))}
                onClick={() => removeContext(p)}
                className="flex size-4 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg"
              >
                <Icon name="ph-x" size={10} />
              </button>
            </span>
          ))}
          {block && (
            <span role="listitem" title={block} className="inline-flex h-6 max-w-[200px] items-center gap-1 rounded-md border border-line bg-raised pr-0.5 pl-2 text-[12px]">
              <Icon name="ph-text-align-left" size={12} />
              <span className="truncate">{T.block}</span>
              <button
                type="button"
                aria-label={T.removeBlock}
                onClick={() => {
                  setBlock(null)
                  setBlockPath(null)
                }}
                className="flex size-4 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg"
              >
                <Icon name="ph-x" size={10} />
              </button>
            </span>
          )}
          <AddContext onPick={addContext} exclude={context} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-live="polite">
        {items.length === 0 && !busy && <p className="px-1 py-6 text-center text-[13px] text-fg-muted">{T.empty}</p>}
        <ol className="flex flex-col gap-3" aria-label={T.title}>
          {items.map((item) =>
            item.role === 'user' ? (
              <li key={item.id} data-role="user" className="flex justify-end">
                <ChatMarkdown source={item.text} className="max-w-[85%] rounded-lg bg-hover px-3 py-2 text-[14px] break-words" />
              </li>
            ) : (
              <li key={item.id} data-role="assistant" className="flex flex-col gap-1">
                <AssistantBody text={item.text} parts={item.parts} />
                {item.stopped && <p className="text-[12px] text-fg-muted">{T.stopped}</p>}
                {item.skipped && item.skipped.length > 0 && (
                  <p className="text-[12px] text-fg-muted">{T.skipped(item.skipped.map((sk) => ({ title: titleOf(sk.path), reason: sk.reason })))}</p>
                )}
                {item.proposal && item.proposalState !== 'dismissed' && (
                  <Proposal
                    item={item}
                    proposal={item.proposal}
                    hasTarget={!!item.target}
                    canReplace={canReplace}
                    canInsert={canInsert}
                    propertyName={(key) => propertyName(key, item.target ?? null)}
                    onAccept={() => accept(item)}
                    onDismiss={() => markProposal(item.id, 'dismissed')}
                    onReplace={(t) => callbacks.current.onReplace?.(t)}
                    onInsertBelow={(t) => callbacks.current.onInsertBelow?.(t)}
                  />
                )}
                <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label={T.assistant}>
                  <IconButton label={T.copy} icon="ph-copy" onClick={() => copyText(item.text)} />
                  <IconButton
                    label={T.appendToPage}
                    icon="ph-arrow-line-down"
                    disabled={!firstPage}
                    title={firstPage ? T.appendToPage : T.appendToPageNone}
                    onClick={() => appendToPage(item.text)}
                  />
                  <IconButton label={T.appendToDailyNote} icon="ph-calendar-plus" onClick={() => appendToDaily(item.text)} />
                  {item === lastAssistant && <IconButton label={T.retry} icon="ph-arrow-counter-clockwise" disabled={!ready || !!busy} onClick={retry} />}
                  <IconButton label={T.rephrase} icon="ph-pencil-simple-line" disabled={!ready || !!busy} onClick={() => rephrase(item)} />
                  {canReplace && <IconButton label={T.replace} icon="ph-swap" onClick={() => callbacks.current.onReplace?.(item.text)} />}
                  {canInsert && <IconButton label={T.insertBelow} icon="ph-text-indent" onClick={() => callbacks.current.onInsertBelow?.(item.text)} />}
                </div>
              </li>
            ),
          )}
          {busy && (
            <li data-role="assistant" data-streaming="" className="flex flex-col gap-1">
              <AssistantBody text={busy.text} parts={busy.parts} streaming />
              <p role="status" className="flex items-center gap-1.5 text-[13px] text-fg-muted">
                <Icon name="ph-sparkle" size={13} />
                {busyLine}
              </p>
            </li>
          )}
        </ol>
        {error && (
          <p role="alert" className="mt-2 text-[13px] text-[var(--danger)]">
            {error}
          </p>
        )}
        {saveError && <p className="mt-2 text-[12px] text-fg-muted">{saveError}</p>}
        <div ref={listEnd} />
      </div>

      {status && !status.available ? (
        <StatusExplanation status={status} />
      ) : (
        <div className="shrink-0 border-t border-line px-3 py-2">
          {showNotice && (
            <div role="note" className="mb-2 flex flex-col gap-2 rounded-lg border border-line bg-raised p-3 text-[13px] text-fg">
              <p>{T.notice}</p>
              <div>
                <TextButton
                  primary
                  onClick={() => {
                    rememberNotice(root)
                    setAcked(true)
                    focusInput()
                  }}
                >
                  {T.ok}
                </TextButton>
              </div>
            </div>
          )}
          {!status && <p className="pb-1 text-[12px] text-fg-muted">{T.checking}</p>}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              aria-label={T.inputLabel}
              placeholder={T.placeholder}
              value={input}
              rows={2}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
              }}
              className="max-h-[160px] min-h-[40px] flex-1 resize-none rounded-md border border-line bg-transparent px-2 py-1.5 text-[14px] text-fg outline-none focus:border-fg-muted"
            />
            {busy ? (
              <IconButton label={T.stop} icon="ph-stop" onClick={stop} />
            ) : (
              <IconButton label={T.send} icon="ph-paper-plane-right" disabled={!ready || !input.trim()} onClick={submit} />
            )}
          </div>
        </div>
      )}

      <RelevantContent path={firstPage} />
    </div>
  )
}

function Proposal({
  item,
  proposal,
  hasTarget,
  canReplace,
  canInsert,
  propertyName,
  onAccept,
  onDismiss,
  onReplace,
  onInsertBelow,
}: {
  item: ChatItem
  proposal: AiProposal
  hasTarget: boolean
  canReplace: boolean
  canInsert: boolean
  propertyName(key: string): string
  onAccept(): void
  onDismiss(): void
  onReplace(text: string): void
  onInsertBelow(text: string): void
}) {
  const accepted = item.proposalState === 'accepted'
  const decide = (
    <div className="flex items-center gap-1.5 pt-1">
      {accepted ? (
        <span className="text-[12px] text-fg-muted">{T.accepted}</span>
      ) : (
        <>
          <TextButton primary onClick={onAccept} disabled={!hasTarget} title={hasTarget ? undefined : T.noTarget}>
            {T.accept}
          </TextButton>
          <TextButton onClick={onDismiss}>{T.dismiss}</TextButton>
        </>
      )}
    </div>
  )
  if (proposal.kind === 'tags') {
    return (
      <section aria-label={T.proposedTags} className="rounded-lg border border-line p-2">
        <p className="pb-1 text-[12px] font-medium text-fg-muted">{T.proposedTags}</p>
        <ul className="flex flex-wrap gap-1">
          {proposal.tags.map((t) => (
            <li key={t} className="rounded-md bg-hover px-2 py-0.5 text-[12px]">
              {t}
            </li>
          ))}
        </ul>
        {decide}
      </section>
    )
  }
  if (proposal.kind === 'properties') {
    return (
      <section aria-label={T.proposedProperties} className="rounded-lg border border-line p-2">
        <p className="pb-1 text-[12px] font-medium text-fg-muted">{T.proposedProperties}</p>
        <table className="w-full text-[13px]">
          <thead className="sr-only">
            <tr>
              <th>{T.property}</th>
              <th>{T.value}</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(proposal.values).map(([k, v]) => (
              <tr key={k}>
                <td className="py-0.5 pr-3 align-top text-fg-muted">{propertyName(k)}</td>
                <td className="py-0.5 break-words text-fg">{formatValue(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {decide}
      </section>
    )
  }
  return (
    <section aria-label={T.proposedText} className="rounded-lg border border-line p-2">
      <p className="pb-1 text-[12px] font-medium text-fg-muted">{T.proposedText}</p>
      <p className="text-[14px] whitespace-pre-wrap break-words">{proposal.text}</p>
      <div className="flex items-center gap-1.5 pt-1">
        {canReplace && <TextButton onClick={() => onReplace(proposal.text)}>{T.replace}</TextButton>}
        {canInsert && <TextButton onClick={() => onInsertBelow(proposal.text)}>{T.insertBelow}</TextButton>}
        {!canReplace && !canInsert && <TextButton onClick={() => copyText(proposal.text)}>{T.copy}</TextButton>}
      </div>
    </section>
  )
}
