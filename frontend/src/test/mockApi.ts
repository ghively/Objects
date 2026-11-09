// A mock of the whole `api` object for component tests. Inject it with:
//
//   vi.mock('@/api/client', async (orig) => ({
//     ...(await orig()),
//     api: (await import('@/test/mockApi')).mockApi(),
//   }))
//
// and reach it as `vi.mocked(api)`. Every function is a `vi.fn()` whose default implementation
// is a sensible empty answer, so `mockReset()` brings a function back to that default.
import { vi } from 'vitest'
import type { Api } from '@/api/client'
import type {
  AddRemoteAgentRequest,
  Agent,
  AgentInput,
  AgentTranscript,
  Attachment,
  AutomationRule,
  AutomationRun,
  CalendarDay,
  CalendarRange,
  Collection,
  CreateAgentRequest,
  DeviceSettings,
  LearningSettings,
  LearningState,
  LedgerSummary,
  McpServer,
  McpServerInput,
  McpTestResult,
  MemoryFile,
  SecretVar,
  ReviewStatus,
  SkillSummary,
  GraphData,
  ImportJob,
  ImportPreview,
  ImportPreviewRequest,
  Layout,
  ObjectDetail,
  ObjectSummary,
  PropertyDef,
  Query,
  RemoteAuthInput,
  RemotePreview,
  SaveRemoteAgentRequest,
  References,
  Row,
  SearchResult,
  SpaceEntry,
  StartImportRequest,
  TaskEntry,
  TypeDef,
  ViewState,
  Views,
  WorkItem,
  WorkStep,
  WorkWriteResult,
  AgentStatus,
  CaptureItem,
  DeskSyncStatus,
  WorkAgentSettings,
  FocusDay,
  FocusLine,
  WorkAlerts,
  WorkBoard,
  WorkBoardItem,
} from '@/api/types'
import { settingsDefaults } from '@/settings/defaults'

/** The MCP config the token routes answer, with `secret` as the token. */
export function mcpConfig(secret: string) {
  return {
    mcpServers: {
      object: {
        command: 'uv',
        args: ['run', '--directory', '/repo', 'objectapp-mcp'],
        env: { OBJECT_API_URL: 'http://127.0.0.1:8790', OBJECT_API_TOKEN: secret },
      },
    },
  }
}

/** A v2 type with every contract field; `partial` overrides. */
export function typeDef(partial: Partial<TypeDef> & Pick<TypeDef, 'id'>): TypeDef {
  const name = partial.name ?? partial.id.charAt(0).toUpperCase() + partial.id.slice(1)
  const pluralName = partial.pluralName ?? `${name}s`
  return {
    schemaVersion: 2,
    name,
    pluralName,
    folder: pluralName,
    formerNames: [],
    icon: { type: 'iconify', val: 'ph-file-text' },
    color: 'gray',
    description: '',
    basic: false,
    propertyDefinitions: [],
    collectionsPropertyPosition: 0,
    viewDesign: null,
    font: 'sans-serif',
    wideLayoutMode: false,
    wideCoverImage: false,
    cropCoverImage: true,
    templates: { ids: [], defaultTemplateId: null },
    readOnlyReason: null,
    revision: '',
    ...partial,
  }
}

/** A property definition with every contract field; `partial` overrides. */
export function propertyDef(partial: Partial<PropertyDef> & Pick<PropertyDef, 'id'>): PropertyDef {
  return {
    key: partial.id,
    name: partial.id,
    type: 'text',
    description: '',
    icon: null,
    visibility: 'alwaysShow',
    options: {},
    ...partial,
  }
}

/** An object summary with every contract field; `partial` overrides. */
export function objectSummary(partial: Partial<ObjectSummary> & Pick<ObjectSummary, 'path'>): ObjectSummary {
  const stem = partial.path.replace(/^.*\//, '').replace(/\.md$/i, '')
  return {
    id: null,
    type: 'page',
    title: stem,
    icon: null,
    iconColor: null,
    description: null,
    aliases: [],
    createdAt: null,
    lastUpdated: null,
    tags: [],
    template: null,
    color: null,
    coverImage: null,
    readOnly: false,
    ...partial,
  }
}

/** An object as `GET /api/object` returns it. */
export function objectDetail(partial: Partial<ObjectDetail> & { summary: ObjectSummary }): ObjectDetail {
  return {
    frontmatter: {},
    body: '',
    version: 'v1',
    links: {},
    backlinks: [],
    ...partial,
  }
}

/** A search result with every contract field; `partial` overrides. */
export function searchResult(partial: Partial<SearchResult> & Pick<SearchResult, 'path'>): SearchResult {
  const stem = partial.path.replace(/^.*\//, '').replace(/\.md$/i, '')
  return {
    title: stem,
    type: 'page',
    icon: null,
    tags: [],
    score: 0,
    titleMatches: [],
    highlights: [],
    ...partial,
  }
}

/** A references payload with every contract field; `partial` overrides. */
export function references(partial: Partial<References> = {}): References {
  return {
    tabs: ['all', 'backlinks', 'related', 'mentions'],
    backlinks: [],
    mentions: [],
    related: [],
    relatedTags: [],
    summaries: {},
    ...partial,
  }
}

/** Graph data with every contract field; `partial` overrides. */
export function graphData(partial: Partial<GraphData> = {}): GraphData {
  return { nodes: [], links: [], tagged: [], ...partial }
}

const emptyGroup = () => ({ type: 'filterGroup' as const, operator: 'and' as const, elements: [] })

function viewState(layout: Layout = 'list'): ViewState {
  return { viewDefinition: { dataViewLayout: layout }, filterGroup: emptyGroup(), sorts: [], groupBy: null }
}

/** Default type-page views, as the server returns them when none are saved. */
export function defaultViews(): Views {
  return { activeTab: 'all', all: viewState(), dashboard: { sections: [], removedSections: [] } }
}

/** A row with every contract field; `partial` overrides (`path` is shorthand for a default summary). */
export function row(partial: Partial<Row> & { path?: string } = {}): Row {
  const { path, ...rest } = partial
  const summary = rest.summary ?? objectSummary({ path: path ?? 'Pages/Untitled.md' })
  return { summary, version: 'v1', values: {}, links: {}, preview: '', ...rest }
}

/** A collection with every contract field; `partial` overrides. */
export function collection(partial: Partial<Collection> & Pick<Collection, 'id'>): Collection {
  return {
    schemaVersion: 1,
    name: partial.id,
    formerNames: [],
    icon: null,
    color: null,
    description: '',
    typeIds: [],
    views: {
      activeTab: 'all',
      all: viewState(),
      dashboard: { sections: [{ key: 'pinned', collapsed: false }], removedSections: [] },
    },
    pinned: { ids: [], isHidden: false },
    templates: { ids: [], defaultTemplateId: null },
    readOnlyReason: null,
    revision: '',
    ...partial,
  }
}

/** A query with every contract field; `partial` overrides. */
export function query(partial: Partial<Query> & Pick<Query, 'id'>): Query {
  const name = partial.name ?? ''
  return {
    schemaVersion: 1,
    name,
    titleIsCustom: name !== '',
    icon: null,
    description: '',
    definition: { types: [], filterGroup: emptyGroup(), sorts: [], groupBy: null },
    view: { viewDefinition: { dataViewLayout: 'list' } },
    readOnlyReason: null,
    revision: '',
    ...partial,
  }
}

/** A calendar day with every contract field; `partial` overrides. */
export function calendarDay(partial: Partial<CalendarDay> = {}): CalendarDay {
  return { dailyNote: null, tasks: [], dated: [], created: [], updated: [], ...partial }
}

/** A calendar range with every contract field; `partial` overrides. */
export function calendarRange(partial: Partial<CalendarRange> = {}): CalendarRange {
  const from = partial.from ?? '2026-10-01'
  return {
    from,
    to: partial.to ?? from,
    today: partial.today ?? from,
    days: {},
    summaries: {},
    warnings: [],
    ...partial,
  }
}

/** A task entry with every contract field; `partial` overrides. */
export function taskEntry(partial: Partial<TaskEntry> = {}): TaskEntry {
  return { path: 'Tasks/Untitled.md', kind: 'date', day: '2026-10-01', done: false, ...partial }
}

/** Device settings: the contract defaults; `partial` overrides. */
export function deviceSettings(partial: Partial<DeviceSettings> = {}): DeviceSettings {
  return { ...settingsDefaults, openOnStart: {}, ...partial }
}

/** A spaces-registry entry with every contract field; `partial` overrides. */
export function spaceEntry(partial: Partial<SpaceEntry> = {}): SpaceEntry {
  const path = partial.path ?? '/spaces/Space'
  return {
    path,
    name: path.replace(/[\\/]+$/, '').replace(/^.*[\\/]/, ''),
    icon: null,
    current: false,
    missing: false,
    lastOpened: null,
    ...partial,
  }
}

/** An attachment with every contract field; `partial` overrides. */
export function attachment(partial: Partial<Attachment> = {}): Attachment {
  return { path: 'Attachments/file.pdf', kind: 'pdf', size: 1024, ...partial }
}

/** An M14 automation rule: a button rule with one "set property" action unless overridden. */
export function automationRule(partial: Partial<AutomationRule> & Pick<AutomationRule, 'id'>): AutomationRule {
  return {
    schemaVersion: 1,
    name: 'New automation',
    description: '',
    enabled: true,
    trigger: { kind: 'button', scope: null },
    conditions: { type: 'filterGroup', operator: 'and', elements: [] },
    actions: [{ kind: 'setProperty', key: 'done', value: true }],
    templateRepeat: null,
    createdAt: '2026-11-05T09:00:00.000Z',
    revision: 'r1',
    readOnlyReason: null,
    lastRun: null,
    ...partial,
  }
}

/**
 * M21: an agent schedule (a weekly schedule rule whose one action runs the default agent), built on
 * `automationRule`; `partial` overrides.
 */
export function agentSchedule(partial: Partial<AutomationRule> = {}): AutomationRule {
  return automationRule({
    id: '01JSCHED000000000000000000',
    name: 'Weekly review',
    trigger: { kind: 'schedule', repeat: 'every week on monday', time: '09:00', start: '2026-11-09' },
    actions: [{ kind: 'runAgent', agentId: 'assistant', prompt: 'Review last week’s notes.', model: null }],
    ...partial,
  })
}

/** An M14 run-log entry (a button run that succeeded) unless overridden. */
export function automationRun(partial: Partial<AutomationRun> & Pick<AutomationRun, 'ruleId'>): AutomationRun {
  return {
    id: '01JRUN0000000000000000000',
    at: '2026-11-05T09:00:00.000Z',
    trigger: { kind: 'button', path: null, scheduledFor: null, catchUp: false },
    status: 'ok',
    actions: [],
    error: null,
    ...partial,
  }
}

/** M17: an agent with every contract field (a local agent, not the default one); `partial` overrides. */
export function agent(partial: Partial<Agent> & Pick<Agent, 'id'>): Agent {
  const isDefault = partial.id === 'assistant'
  return {
    kind: 'local',
    name: isDefault ? 'Assistant' : 'Researcher',
    icon: isDefault ? 'ph-sparkle' : 'ph-robot',
    color: null,
    description: '',
    model: null,
    toolsOff: ['Bash'],
    learning: null,
    createdAt: '2026-11-05T09:00:00.000Z',
    updatedAt: '2026-11-05T09:00:00.000Z',
    default: isDefault,
    folder: `/state/agents/${isDefault ? 'Assistant' : 'Researcher'}`,
    inStateDir: true,
    exists: true,
    missing: false,
    readOnlyReason: null,
    revision: 'r1',
    mcpServers: [],
    remote: null,
    warnings: [],
    ...partial,
  }
}

/** M20: a remote agent ("Fake Planner", bearer auth set, streaming); `partial` overrides. */
export function remoteAgent(partial: Partial<Agent> & Pick<Agent, 'id'>): Agent {
  return agent({
    kind: 'remote',
    name: 'Fake Planner',
    icon: 'ph-globe',
    model: null,
    toolsOff: [],
    learning: null,
    folder: '/state/agents/Fake Planner',
    mcpServers: [],
    remote: {
      cardUrl: 'http://127.0.0.1:8799/.well-known/agent-card.json',
      endpointUrl: 'http://127.0.0.1:8799/a2a',
      endpointHost: '127.0.0.1',
      protocolVersion: '1.0',
      streaming: true,
      auth: { kind: 'bearer', headerName: null, set: true },
      pendingEndpoint: null,
      card: remotePreview().card,
      cardFetchedAt: '2026-11-05T09:00:00.000Z',
      contextNoticeAt: null,
    },
    ...partial,
  })
}

/** M20: a remote agent's card preview (no warnings); `partial` overrides. */
export function remotePreview(partial: Partial<RemotePreview> = {}): RemotePreview {
  return {
    cardUrl: 'http://127.0.0.1:8799/.well-known/agent-card.json',
    card: {
      name: 'Fake Planner',
      description: "A synthetic agent for Object's tests.",
      version: '1.0.0',
      provider: 'Fake Org',
      documentationUrl: 'https://example.org/docs',
      skills: [
        {
          id: 'plan-trip',
          name: 'Plan a trip',
          description: 'Plans a short trip.',
          tags: ['travel'],
          examples: ['Plan two days in Lisbon.'],
        },
      ],
      streaming: true,
      inputModes: ['text/plain', 'text/markdown'],
      outputModes: ['text/plain', 'application/json'],
    },
    endpointUrl: 'http://127.0.0.1:8799/a2a',
    endpointHost: '127.0.0.1',
    warnings: [],
    ...partial,
  }
}

/** M17: a chat transcript of `agentId` (one user line, one assistant line); `partial` overrides. */
export function agentTranscript(partial: Partial<AgentTranscript> & Pick<AgentTranscript, 'id'>): AgentTranscript {
  return {
    title: 'What do my notes say?',
    createdAt: '2026-11-05T09:00:00.000Z',
    updatedAt: '2026-11-05T09:01:00.000Z',
    messageCount: 2,
    spaceName: 'space',
    delegated: false,
    from: null,
    schedule: null,
    agentId: 'assistant',
    sessionId: 's1',
    objectPath: null,
    items: [
      { type: 'user', text: 'What do my notes say?', at: '2026-11-05T09:00:00.000Z', contextPaths: [] },
      { type: 'assistant', text: 'Hello', at: '2026-11-05T09:01:00.000Z', model: null, sessionId: 's1' },
    ],
    ...partial,
  }
}

/** M18: a skill (an agent-made, active one); `partial` overrides. */
export function skillSummary(partial: Partial<SkillSummary> & Pick<SkillSummary, 'name'>): SkillSummary {
  return {
    description: 'How to label server racks',
    createdBy: 'agent',
    state: 'active',
    pinned: false,
    uses: 0,
    lastUsed: null,
    createdAt: '2026-11-05T09:00:00.000Z',
    absorbedInto: null,
    ...partial,
  }
}

/** M18: a ledger entry without its before and after (a memory saved in a chat); `partial` overrides. */
export function ledgerSummary(partial: Partial<LedgerSummary> & Pick<LedgerSummary, 'id'>): LedgerSummary {
  return {
    at: '2026-11-05T09:00:00.000Z',
    target: 'memory',
    action: 'add',
    skill: null,
    file: null,
    absorbedInto: null,
    source: { kind: 'chat', agentId: 'assistant', chatId: '01JCHAT0000000000000000000', run: null },
    undoes: null,
    line: 'Saved a memory',
    ...partial,
  }
}

/** M18: a finished automatic review of both kinds; `partial` overrides. */
export function reviewStatus(partial: Partial<ReviewStatus> & Pick<ReviewStatus, 'id'>): ReviewStatus {
  return {
    agentId: 'assistant',
    chatId: '01JCHAT0000000000000000000',
    kinds: ['memory', 'skills'],
    trigger: 'auto',
    state: 'done',
    startedAt: '2026-11-05T09:00:00.000Z',
    endedAt: '2026-11-05T09:00:30.000Z',
    summary: 'Saved 1 memory, updated 1 skill',
    message: null,
    entryIds: [],
    ...partial,
  }
}

const LEARNING_DEFAULTS: LearningSettings = {
  memoryChars: 2200,
  userChars: 1375,
  memoryReviewEvery: 10,
  skillReviewEvery: 10,
  reviewModel: null,
  curator: true,
  curatorIdleHours: 2,
  curatorEveryDays: 7,
  consolidate: false,
}

/** M18: an agent's learning state with the default settings; `partial` overrides. */
export function learningState(partial: Partial<LearningState> = {}): LearningState {
  return {
    settings: { ...LEARNING_DEFAULTS },
    defaults: { ...LEARNING_DEFAULTS },
    curator: { lastRunAt: null, nextDueAt: null, running: false, report: null },
    revision: 'r1',
    ...partial,
  }
}

function memoryFile(target: MemoryFile['target'], text = '', revision: string | null = null): MemoryFile {
  const entries = text ? text.split(/\n§\n/).filter((e) => e.trim() !== '') : []
  return { target, text, entries, chars: text.length, cap: target === 'memory' ? 2200 : 1375, revision }
}

/** M19: a stdio MCP server with one plain and one stored secret env row (no value ever); `partial` overrides. */
export function mcpServer(partial: Partial<McpServer> & Pick<McpServer, 'id'>): McpServer {
  return {
    name: 'fake',
    enabled: true,
    kind: 'command',
    command: 'npx',
    args: ['-y', 'some-mcp-server'],
    env: [
      { key: 'LOG_LEVEL', value: 'info', secret: false, set: false },
      { key: 'API_KEY', value: null, secret: true, set: true },
    ],
    transport: null,
    url: null,
    headers: [],
    bearer: false,
    createdAt: '2026-11-05T09:00:00.000Z',
    updatedAt: '2026-11-05T09:00:00.000Z',
    revision: 'r1',
    missingSecrets: [],
    lastTest: null,
    ...partial,
  }
}

/** M19: a passing Test listing `echo`, `add` and `whoami`; `partial` overrides. */
export function mcpTestResult(partial: Partial<McpTestResult> = {}): McpTestResult {
  return {
    ok: true,
    tools: [
      { name: 'add', description: 'Add two numbers.' },
      { name: 'echo', description: 'Echo the text back.' },
      { name: 'whoami', description: 'The value of the variable named by --require-env.' },
    ],
    error: null,
    elapsedMs: 120,
    at: '2026-11-05T09:00:00.000Z',
    ...partial,
  }
}

/** M19: a secret variable (never its value); `partial` overrides. */
export function secretVar(partial: Partial<SecretVar> & Pick<SecretVar, 'name'>): SecretVar {
  return { set: false, settable: true, usedBy: [], ...partial }
}

/** M22: a work step: an open Do step, first and current, unless `partial` says otherwise. */
export function workStep(partial: Partial<WorkStep> = {}): WorkStep {
  return {
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
    n: 1,
    current: true,
    actions: [],
    ...partial,
  }
}

/** M22: a work item with every contract field; the title follows `path` unless given. */
export function workItem(partial: Partial<WorkItem> = {}): WorkItem {
  const path = partial.path ?? 'Tasks/Printer jams on line 3.md'
  const steps = partial.steps ?? []
  const current = steps.find((s) => s.current) ?? null
  return {
    path,
    objectId: null,
    title: path.replace(/^.*\//, '').replace(/\.md$/, ''),
    typeId: 'task',
    version: 'v1',
    ticket: null,
    rank: null,
    area: null,
    cause: null,
    priority: null,
    priorityNote: null,
    blockedOn: null,
    confidence: null,
    status: 'In Progress',
    stage: 'doing',
    done: false,
    doneAt: null,
    recentlyDone: false,
    turn: steps.length === 0 ? 'none' : 'you',
    deskSays: null,
    current,
    stepCount: steps.length,
    stepsFinished: steps.filter((s) => s.state === 'done' || s.state === 'declined').length,
    projectPath: null,
    lastActivity: null,
    lastTouched: '2026-11-05T10:00:00.000Z',
    problems: [],
    stepsUnreadable: false,
    fields: {},
    steps,
    verified: [],
    assumed: [],
    toRaiseConfidence: [],
    floorItems: [],
    findings: null,
    hypothesis: null,
    confidenceReason: null,
    activity: [],
    workNotes: [],
    resolution: null,
    ...partial,
  }
}

/** M22: what a work write answers: the item at `version`, one Activity line, no Work notes line. */
export function workWriteResult(partial: Partial<WorkWriteResult> = {}): WorkWriteResult {
  const version = partial.version ?? 'v2'
  const item = partial.item ?? workItem({ version })
  return {
    version,
    frontmatter: {},
    body: '',
    item,
    synced: [],
    activity: '2026-11-05 10:00 Gene marked done step 1 "Check the printer cable"',
    workNote: null,
    ...partial,
  }
}

/** M23: a board item: `workItem`'s summary fields plus the board's, without the item-only keys. */
export function workBoardItem(over: Partial<WorkBoardItem> = {}): WorkBoardItem {
  const {
    fields: _fields, verified: _verified, assumed: _assumed, toRaiseConfidence: _raise, findings: _findings,
    confidenceReason: _reason, activity: _activity, workNotes: _notes, resolution: _resolution, ...summary
  } = workItem(over as Partial<WorkItem>)
  return {
    ...summary,
    typeName: 'Task',
    isProject: false,
    deadline: null,
    blockedOnPeople: [],
    ...over,
  }
}

/** M23: a board at the fixtures' clock (2026-11-05T10:00Z, UTC). */
export function workBoard(items: WorkBoardItem[] = []): WorkBoard {
  return { items, now: '2026-11-05T10:00:00.000Z', today: '2026-11-05', timeZone: 'UTC' }
}

/** M23: today's focus lines from their raw texts (`[[a|b]]` shows `b`; links unresolved). */
export function focusDay(lines: string[] = [], over: Partial<FocusDay> = {}): FocusDay {
  const focus: FocusLine[] = lines.map((text, i) => ({
    n: i + 1,
    text,
    label: text.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2').replace(/\[\[([^\]]*)\]\]/g, '$1'),
    links: [...text.matchAll(/\[\[([^\]|]*)(?:\|[^\]]*)?\]\]/g)].map((m) => ({ target: m[1], path: null })),
  }))
  return {
    day: '2026-11-05',
    notePath: lines.length ? 'DailyNotes/2026-11-05.md' : null,
    version: lines.length ? 'v1' : null,
    hasSection: lines.length > 0,
    lines: focus,
    ...over,
  }
}

/** M23: the agent status before M24 (no agent; nothing carried unless `over` says so). */
export function agentStatus(over: Partial<AgentStatus> = {}): AgentStatus {
  return {
    available: false,
    agentName: null,
    actsOnApprovals: false,
    carrying: 0,
    rows: [],
    note: 'The agent loop comes with M24.',
    ...over,
  }
}

/** M24: no work agent yet. */
export function workAgentSettings(over: Partial<WorkAgentSettings> = {}): WorkAgentSettings {
  return {
    agentId: null,
    agent: null,
    problem: 'Create the Work agent first.',
    acts: false,
    autoRun: true,
    readTools: [],
    settingsRevision: '',
    ...over,
  }
}

/** M24: a New brain dump. */
export function captureItem(over: Partial<CaptureItem> = {}): CaptureItem {
  return {
    path: 'Captures/Tray 2 jams again.md',
    text: 'Tray 2 jams again',
    status: 'new',
    question: null,
    capturedAt: '2026-11-05T10:00:00.000Z',
    linkedPath: null,
    objectId: 'cap1',
    version: 'v1',
    title: 'Tray 2 jams again',
    fromView: 'now',
    linkedTitle: null,
    filedTo: null,
    route: 'file',
    ...over,
  }
}

/** M24: Desk sync not set up. */
export function deskSyncStatus(over: Partial<DeskSyncStatus> = {}): DeskSyncStatus {
  return { ruleId: null, enabled: false, repeat: null, time: null, lastRun: null, markedReadTools: 0, ...over }
}

/** M23: no alerts, no folder, no Alert type. */
export function workAlerts(over: Partial<WorkAlerts> = {}): WorkAlerts {
  return {
    alerts: [],
    sources: [],
    counts: { Critical: 0, Warning: 0, Info: 0 },
    folder: null,
    typeExists: false,
    ...over,
  }
}

/** The client's `UnavailableError` (imported when thrown: a module that mocks `@/api/client` loads this one). */
async function unavailable(detail: string): Promise<Error> {
  const { UnavailableError } = await import('@/api/client')
  return new UnavailableError(detail)
}

type Fn =(...args: never[]) => unknown

function defaults(): Api {
  return {
    appInfo: async () => ({ version: '0.1.0' }),
    space: async () => ({
      name: 'space',
      root: '/space',
      types: [],
      icon: null,
      description: null,
      hideTaskManagement: false,
      revision: '',
    }),
    objects: async () => [],
    object: async (path: string) => objectDetail({ summary: objectSummary({ path }) }),
    saveBody: async (_path: string, _body: string, baseVersion: string) => ({ version: `${baseVersion}+1` }),
    updateProperties: async (_path: string, updates: Record<string, unknown>, baseVersion: string) => ({
      version: `${baseVersion}+1`,
      frontmatter: { ...updates },
      links: {},
      synced: [],
      skipped: [],
    }),
    ensureId: async () => ({ id: '01MOCKID0000000000000000', version: 'v1+1' }),
    renameObject: async (path: string, title: string, baseVersion: string) => ({
      path: `${path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''}${title}.md`,
      version: `${baseVersion}+1`,
      relinked: [],
      skipped: [],
    }),
    suggestMapping: async () => [],
    changeType: async (path: string, _typeId: string, _mapping: Record<string, string | null>, baseVersion: string) => ({
      path,
      version: `${baseVersion}+1`,
      relinked: [],
      skipped: [],
    }),
    createObject: async (typeId: string, opts: { title?: string } = {}) => ({
      path: `${typeId}/${opts.title || 'Untitled'}.md`,
      version: 'v1',
    }),
    duplicateObject: async (path: string) => {
      const copy = path.replace(/\.md$/, ' (Copy).md')
      const title = copy.slice(copy.lastIndexOf('/') + 1).replace(/\.md$/, '')
      return { path: copy, version: 'v1', summary: objectSummary({ path: copy, title }) }
    },
    exportProperties: async () => [],
    typeGallery: async () => [],
    exportObjectUrl: (path: string, opts: { media: boolean }) =>
      `/api/object/export?path=${encodeURIComponent(path)}&media=${opts.media ? 1 : 0}`,
    createDailyNote: async (date: string) => ({ path: `DailyNotes/${date}.md`, version: 'v1', typeIds: [] }),
    calendar: async (from: string, to: string) => calendarRange({ from, to, today: from }),
    deleteObject: async () => ({ trashId: 'trash-1' }),
    trash: async () => [],
    restore: async () => ({ paths: [], typeIds: [], collectionIds: [], queryIds: [], skipped: [] }),
    purge: async () => ({ purged: 1 }),
    emptyTrash: async () => ({ purged: 0 }),
    createType: async (input: { name: string; pluralName: string }) =>
      typeDef({ id: input.name.toLowerCase(), name: input.name, pluralName: input.pluralName, revision: 'r1' }),
    saveType: async (type: TypeDef) => ({ type: { ...type, revision: `${type.revision}+1` }, rewritten: [], skipped: [] }),
    changePropertyKind: async (typeId: string) => ({
      type: typeDef({ id: typeId }),
      newPropertyId: 'p-new',
      rewritten: [],
      skipped: [],
      lossy: 0,
    }),
    setPropertySync: async () => ({ types: [], rewritten: [], skipped: [] }),
    createRelationPair: async (typeId: string) => ({
      type: typeDef({ id: typeId }),
      firstId: 'p-first',
      secondId: 'p-second',
      created: true,
    }),
    formulaPreview: async () => ({ value: null, error: null }),
    numberExistingObjects: async (typeId: string) => ({
      type: typeDef({ id: typeId }),
      numbered: 0,
      rewritten: [],
      skipped: [],
    }),
    deleteType: async () => ({ trashId: 'trash-type-1' }),
    templates: async () => [],
    createTemplate: async (typeId: string, name?: string) => ({
      path: `Templates/${typeId}/${name ?? 'New template'}.md`,
      version: 'v1',
    }),
    applyTemplate: async (_path: string, _templateId: string, baseVersion: string) => ({ version: `${baseVersion}+1` }),
    ensureTag: async (name: string) => ({ path: `Tags/${name}.md`, created: false }),
    images: async () => [],
    importImage: async (name: string) => ({ path: `Attachments/${name}` }),
    fileUrl: (path: string) => `/api/file?path=${encodeURIComponent(path)}`,
    resolve: async () => null,
    reveal: async () => undefined,
    rows: async () => [],
    views: async () => ({ views: defaultViews(), revision: '' }),
    saveViews: async () => ({ revision: 'r1' }),
    collections: async () => [],
    createCollection: async (name: string, typeIds: string[]) =>
      collection({ id: name.toLowerCase().replace(/\s+/g, '-'), name, typeIds, revision: 'r1' }),
    saveCollection: async (c: Collection) => ({ collection: { ...c, revision: `${c.revision}+1` }, rewritten: [], skipped: [] }),
    deleteCollection: async () => ({ trashId: 'trash-collection-1', removedFrom: [], skipped: [] }),
    queries: async () => [],
    createQuery: async (init: Partial<Query> = {}) => query({ ...init, id: 'new-query', name: init.name ?? '', revision: 'r1' }),
    saveQuery: async (q: Query) => ({ query: { ...q, revision: `${q.revision}+1` } }),
    deleteQuery: async () => ({ trashId: 'trash-query-1' }),
    ui: async () => ({ ui: { pinned: [], sections: [], allNotesLayout: 'list' as const }, revision: '' }),
    patchUi: async (patch: Record<string, unknown>) => ({
      ui: { pinned: [], sections: [], allNotesLayout: 'list' as const, ...patch },
      revision: 'r1',
    }),
    search: async () => ({ results: [], partial: false }),
    reindex: async () => ({ started: true }),
    aiStatus: async () => ({ available: true, reason: 'ok' as const, claudePath: '/usr/bin/claude', version: '2.0.0', message: null }),
    aiModels: async () => ({
      models: [
        { id: 'fable', label: 'Fable (latest)', kind: 'alias' as const },
        { id: 'opus', label: 'Opus (latest)', kind: 'alias' as const },
        { id: 'sonnet', label: 'Sonnet (latest)', kind: 'alias' as const },
        { id: 'haiku', label: 'Haiku (latest)', kind: 'alias' as const },
        { id: 'claude-fable-5-1', label: 'Fable 5.1', kind: 'id' as const },
        { id: 'claude-opus-5-5', label: 'Opus 5.5', kind: 'id' as const },
        { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', kind: 'id' as const },
        { id: 'claude-haiku-5-5', label: 'Haiku 5.5', kind: 'id' as const },
      ],
      pattern: '[A-Za-z0-9][A-Za-z0-9._:\\[\\]-]{0,79}',
    }),
    aiChat: async (_req: unknown, onEvent: (e: import('@/api/types').AiEvent) => void) => {
      onEvent({ type: 'text', text: 'Hello' })
      onEvent({ type: 'done', text: 'Hello', sessionId: 's1', proposal: null, skipped: [] })
    },
    aiChatLoad: async (path: string) => ({
      path,
      version: 'v1',
      title: 'Chat',
      contextPaths: [],
      sessionId: null,
      messages: [],
      agent: null,
      agentId: 'assistant',
      chatId: null,
    }),
    saveAiChat: async (req: { path?: string | null }) => ({ path: req.path ?? 'AI Chats/Chat.md', version: 'v1' }),
    apiTokens: async () => ({ tokens: [], mcp: mcpConfig('<token>') }),
    createApiToken: async (name: string, scope: 'read' | 'read-write') => ({
      token: { id: 'tok1', name, scope, createdAt: '2026-11-05T12:00:00.000Z', lastUsedAt: null },
      secret: 'obj_secret',
      mcpConfig: mcpConfig('obj_secret'),
    }),
    revokeApiToken: async (id: string) => ({ revoked: id }),
    references: async () => references(),
    linkMention: async (input: { baseVersion: string }) => ({ version: `${input.baseVersion}+1` }),
    graph: async () => graphData(),
    attachments: async () => [],
    uploadAttachment: async (_blob: Blob | ArrayBuffer, name: string) => ({ path: `Attachments/${name}`, kind: 'file' as const }),
    openAttachment: async () => ({ ok: true as const }),
    patchSpace: async (patch: Record<string, unknown>) => ({
      name: 'space',
      root: '/space',
      types: [],
      icon: null,
      description: null,
      hideTaskManagement: false,
      ...patch,
      revision: 'r1',
    }),
    settings: async () => ({ settings: deviceSettings(), revision: '' }),
    patchSettings: async (patch: Partial<DeviceSettings>) => ({ settings: deviceSettings(patch), revision: 'r1' }),
    spaces: async () => [spaceEntry({ path: '/space', name: 'space', current: true })],
    spaceSetup: async () => ({ name: 'space', root: '/space', types: [], needsSetup: false }),
    createSpace: async (name: string, location: string) => ({ path: `${location.replace(/[\\/]+$/, '')}/${name}` }),
    openSpace: async (path: string) => ({ path }),
    removeSpace: async () => ({ ok: true as const }),
    switchSpace: async (path: string) => ({ path }),
    // M8
    overdue: async () => ({ count: 0, capped: false, missed: [], current: null, today: '2026-10-27' }),
    occurrence: async (_path: string, _action: string, opts: { baseVersion: string }) => ({
      version: `${opts.baseVersion}+1`,
      frontmatter: {},
      links: {},
      synced: [],
      skipped: [],
    }),
    taskStats: async () => ({
      unit: 'day' as const,
      currentStreak: 0,
      bestStreak: 0,
      completions: 0,
      completionRate: null,
      atRisk: false,
      cells: [],
    }),
    setReminder: async (_path: string, _key: string, _remind: string | null, opts: { baseVersion: string }) => ({
      version: `${opts.baseVersion}+1`,
      frontmatter: {},
      links: {},
      synced: [],
      skipped: [],
    }),
    block: async (path: string, id: string) => ({ path, id, markdown: '', version: 'v1' }),
    blockReferences: async () => ({ paths: [] }),
    history: async () => [],
    historyVersion: async (_path: string, id: string) => ({ id, text: '' }),
    restoreVersion: async (_path: string, _id: string, opts: { baseVersion: string }) => ({ version: `${opts.baseVersion}+1` }),
    mergeObject: async (_source: string, target: string, opts: { targetVersion: string }) => ({
      target,
      version: `${opts.targetVersion}+1`,
      relinked: [],
      skipped: [],
      dropped: [],
      trashId: 'trash-merge-1',
    }),
    deleteSpace: async () => ({ trashed: true }),
    importPreview: async (req: ImportPreviewRequest): Promise<ImportPreview> => ({
      previewId: 'preview-1',
      sourcePath: req.source.path,
      kind: req.source.kind && req.source.kind !== 'auto' ? req.source.kind : 'obsidian',
      detected: null,
      container: 'folder',
      suggestedName: 'Import',
      counts: {
        objects: 0,
        types: 0,
        properties: 0,
        attachments: 0,
        attachmentBytes: 0,
        links: 0,
        resolvedLinks: 0,
        unresolvedLinks: 0,
        renamed: 0,
        skipped: 0,
      },
      types: [],
      mapping: req.mapping ?? { typeSource: 'folder', typeKey: null, types: {}, properties: {} },
      frontmatterKeys: [],
      folders: [],
      samples: [],
      skipped: [],
      warnings: [],
    }),
    startImport: async (req: StartImportRequest) => ({
      jobId: 'import-job-1',
      targetPath: req.target.kind === 'newSpace' ? `${req.target.location.replace(/[\\/]+$/, '')}/${req.target.name}` : '/space',
    }),
    importJob: async (jobId: string): Promise<ImportJob> => ({
      id: jobId,
      phase: 'done',
      done: 0,
      total: 0,
      targetPath: '/space',
      currentPath: null,
      result: null,
      error: null,
    }),
    cancelImport: async () => ({ ok: true }),
    // M25
    importBatches: async () => [],
    // M27
    importProposal: async () => ({ proposal: null, review: null }),
    saveProposalReview: async () => ({ ok: true }),
    applyProposal: async () => ({ created: [], extended: [] }),
    startFiling: async () => ({ ok: true }),
    filingStatus: async () => ({ state: 'idle', trial: { items: [], rightShare: null }, normalise: [] }),
    markFiling: async () => ({ ok: true }),
    continueFiling: async () => ({ ok: true }),
    normaliseFiling: async () => ({ ok: true }),
    importBatch: async (id: string) => ({
      batch: { id, startedAt: '', source: { path: '', kind: '', system: '' }, counts: {} },
      items: [],
    }),
    trashImportBatch: async () => ({ trashed: 0, missing: 0 }),
    resolveImportBatch: async () => ({ resolved: [], failed: [], pending: 0 }),
    revealImportOriginal: async () => ({ ok: true }),
    // M14
    automations: async () => [],
    automation: async (id: string) => automationRule({ id }),
    createAutomation: async (input: Partial<AutomationRule>) => automationRule({ ...input, id: '01JNEWRULE000000000000000', revision: 'r1' }),
    saveAutomation: async (rule: AutomationRule) => ({ rule: { ...rule, revision: `${rule.revision}+1` } }),
    deleteAutomation: async () => ({ trashId: 'trash-automation-1' }),
    runAutomation: async (id: string, path: string) =>
      automationRun({ ruleId: id, trigger: { kind: 'button', path, scheduledFor: null, catchUp: false } }),
    runScheduleNow: async (id: string) => automationRun({ ruleId: id }),
    automationRuns: async () => [],
    automationCatchUp: async () => [],
    confirmAutomationCatchUp: async () => [],
    // M17
    agents: async () => [agent({ id: 'assistant', exists: false })],
    agent: async (id: string) => agent({ id }),
    createAgent: async (req: CreateAgentRequest) =>
      agent({ id: '01JNEWAGENT000000000000000', name: req.agent.name, revision: 'r1' }),
    addAgentFolder: async (path: string) => agent({ id: '01JADDEDAGENT0000000000000', folder: path, inStateDir: false }),
    saveAgent: async (id: string, input: AgentInput, baseRevision: string | null) =>
      agent({ id, name: input.name, revision: `${baseRevision ?? 'r0'}+1` }),
    deleteAgent: async () => ({ trashId: 'agent-trash-1' }),
    unregisterAgent: async () => ({ ok: true as const }),
    agentTrash: async () => [],
    restoreAgent: async () => agent({ id: '01JRESTOREDAGENT0000000000' }),
    agentInstructions: async () => ({ text: '', revision: null }),
    saveAgentInstructions: async (_id: string, _text: string, baseRevision: string | null) => ({
      revision: `${baseRevision ?? 'r0'}+1`,
    }),
    agentToolDefaults: async () => [],
    agentTools: async () => [],
    agentChats: async () => [],
    agentChat: async (id: string, chatId: string) => agentTranscript({ id: chatId, agentId: id }),
    revealAgentFolder: async () => ({ ok: true }),
    // M20
    previewRemoteAgent: async (_url: string, _auth: RemoteAuthInput) => remotePreview(),
    addRemoteAgent: async (req: AddRemoteAgentRequest) =>
      remoteAgent({ id: '01JNEWREMOTE00000000000000', name: req.name ?? 'Fake Planner', revision: 'r1' }),
    saveRemoteAgent: async (id: string, req: SaveRemoteAgentRequest) =>
      remoteAgent({ id, name: req.name, revision: `${req.baseRevision}+1` }),
    refreshRemoteAgent: async (id: string) => ({ ...remoteAgent({ id }), warnings: [], notice: null }),
    confirmRemoteEndpoint: async (id: string) => remoteAgent({ id }),
    dismissRemoteEndpoint: async (id: string) => remoteAgent({ id }),
    ackRemoteContext: async () => ({ contextNoticeAt: '2026-11-05T09:00:00.000Z' }),
    revealAgentFile: async () => ({ ok: true as const }),
    // M18
    agentMemory: async () => ({ memory: memoryFile('memory'), user: memoryFile('user') }),
    saveAgentMemory: async (_id: string, target: MemoryFile['target'], text: string, baseRevision: string | null) =>
      memoryFile(target, text, `${baseRevision ?? 'r0'}+1`),
    agentSkills: async () => [],
    createAgentSkill: async (_id: string, req: { name: string; description: string; body: string }) => ({
      ...skillSummary({ name: req.name, description: req.description, createdBy: 'user' }),
      text: req.body,
      revision: 'r1',
      files: [{ path: 'SKILL.md', size: req.body.length }],
    }),
    agentSkill: async (_id: string, name: string) => ({
      ...skillSummary({ name }),
      text: '',
      revision: 'r1',
      files: [{ path: 'SKILL.md', size: 0 }],
    }),
    agentSkillFile: async (_id: string, _name: string, path: string) => ({ path, text: '', revision: 'r1', binary: false }),
    saveAgentSkillFile: async (_id: string, _name: string, _path: string, _text: string, baseRevision: string | null) => ({
      revision: `${baseRevision ?? 'r0'}+1`,
    }),
    archiveAgentSkill: async (_id: string, name: string) => skillSummary({ name, state: 'archived' }),
    restoreAgentSkill: async (_id: string, name: string) => skillSummary({ name }),
    pinAgentSkill: async (_id: string, name: string, pinned: boolean) => skillSummary({ name, pinned }),
    agentLedger: async () => ({ entries: [], more: false }),
    agentLedgerEntry: async (_id: string, entryId: string) => ({
      ...ledgerSummary({ id: entryId }),
      before: null,
      after: 'A memory',
      encoding: 'text' as const,
    }),
    undoLedgerEntry: async (_id: string, entryId: string) =>
      ledgerSummary({ id: '01JUNDO0000000000000000000', action: 'undo', undoes: entryId, line: 'Undid: Saved a memory' }),
    agentLearning: async () => learningState(),
    saveAgentLearning: async (_id: string, learning: Partial<LearningSettings>, baseRevision: string | null) =>
      learningState({ settings: { ...LEARNING_DEFAULTS, ...learning }, revision: `${baseRevision ?? 'r0'}+1` }),
    tidyAgentSkills: async () => ({ runId: '01JTIDY0000000000000000000' }),
    searchAgentChats: async () => [],
    learnFromChat: async (id: string, chatId: string) =>
      reviewStatus({ id: '01JREVIEW00000000000000000', agentId: id, chatId, trigger: 'manual', state: 'running', endedAt: null, summary: null }),
    chatReviews: async () => [],
    // M19
    mcpServers: async () => ({ servers: [], readOnlyReason: null, unreadable: false }),
    createMcpServer: async (input: McpServerInput) =>
      mcpServer({ id: '01JNEWMCPSERVER00000000000', name: input.name, enabled: input.enabled, kind: input.kind, env: [], args: [] }),
    saveMcpServer: async (id: string, input: McpServerInput, baseRevision: string) =>
      mcpServer({ id, name: input.name, enabled: input.enabled, kind: input.kind, revision: `${baseRevision}+1` }),
    deleteMcpServer: async () => ({ ok: true as const }),
    testMcpServer: async () => mcpTestResult(),
    mcpSecrets: async () => [],
    setMcpSecret: async (name: string) => ({ name, set: true as const }),
    deleteMcpSecret: async () => ({ ok: true as const }),
    refreshAgentTools: async () => [],
    // M22
    workItems: async () => [],
    workItem: async (path: string) => workItem({ path }),
    workStep: async (req: { path: string }) => workWriteResult({ item: workItem({ path: req.path }) }),
    workSteps: async (path: string) => workWriteResult({ item: workItem({ path }) }),
    workFields: async (path: string) => workWriteResult({ item: workItem({ path }) }),
    workNote: async (path: string) => workWriteResult({ item: workItem({ path }) }),
    workClose: async (path: string) => workWriteResult({ item: workItem({ path }) }),
    workFloor: async (req: { path: string }) => workWriteResult({ item: workItem({ path: req.path }) }),
    addWorkFields: async (typeId: string, baseRevision: string) => ({
      type: typeDef({ id: typeId, revision: `${baseRevision}+1` }),
      added: [],
      skipped: [],
    }),
    // M23 (the seams answer as the M23 server does: 501 until M24)
    workBoard: async () => workBoard(),
    workFocus: async (day?: string) => focusDay([], day ? { day } : {}),
    saveWorkFocus: async (day: string, lines: string[]) =>
      focusDay(lines, { day, notePath: `DailyNotes/${day}.md`, version: 'v2', hasSection: true }),
    workToday: async (day?: string) => ({
      day: day ?? '2026-11-05',
      now: '2026-11-05T10:00:00.000Z',
      nowLocal: '10:00',
      meetings: [],
    }),
    workWins: async () => ({ days: [], stepsDone: 0, itemsClosed: 0, objectsChanged: 0, got: [] }),
    workAlerts: async () => workAlerts(),
    scanAlerts: async () => ({
      report: { files: 0, created: 0, updated: 0, cleared: 0, unchanged: 0, errors: [] },
      alerts: workAlerts(),
    }),
    ensureAlertType: async () => ({ type: typeDef({ id: 'alert', name: 'Alert', pluralName: 'Alerts' }), created: true }),
    generalFloor: async () => ({ items: [], revision: '' }),
    generalFloorOp: async () => ({ items: [], revision: 'r1' }),
    workAgent: async () => agentStatus(),
    setAgentActs: async () => {
      throw await unavailable('The agent loop comes with M24.')
    },
    retryAgentEntry: async () => {
      throw await unavailable('The agent loop comes with M24.')
    },
    workCapture: async () => {
      throw await unavailable('Saving a brain dump comes with M24.')
    },
    workCaptures: async () => [],
    workAgentSettings: async () => workAgentSettings(),
    saveWorkAgentSettings: async () => workAgentSettings(),
    workAgentCreateInfo: async () => ({ name: 'Work', changeReviewer: null }),
    createWorkAgent: async () => {
      throw new Error('createWorkAgent is not mocked')
    },
    workReadTools: async () => [],
    captureItems: async () => [],
    replyCapture: async () => captureItem(),
    markCaptureFiled: async () => captureItem({ status: 'filed' }),
    deskSync: async () => deskSyncStatus(),
    setUpDeskSync: async () => deskSyncStatus(),
    keepOnTopInfo: async () => ({ window: false }),
    openKeepOnTop: async () => {
      throw await unavailable('Keep on top needs the Object window.')
    },
    onChange: () => () => undefined,
  } as unknown as Api
}

/** A mocked `api`: every function a `vi.fn()` with a default implementation; `overrides` replace defaults. */
export function mockApi(overrides: Partial<Api> = {}): Api {
  const base = defaults() as unknown as Record<string, Fn>
  const extra = overrides as unknown as Record<string, Fn | undefined>
  const out: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(base), ...Object.keys(extra)])) {
    const impl = extra[key] ?? base[key]
    out[key] = vi.isMockFunction(impl) ? impl : vi.fn(impl)
  }
  return out as unknown as Api
}
