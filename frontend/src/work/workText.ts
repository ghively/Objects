/**
 * M23: every string of the Work section (plan `2026-11-05-m23-work-section.md`). The spec's labels
 * are verbatim; the rest are ours (marked "ours") or ported from the old dashboard ("ported").
 *
 * M22's `settings/sections/Work.tsx` exports its own `WORK_TEXT` (the settings section's strings):
 * a file that needs both imports this one under another name.
 */
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

export const WORK_TEXT = {
  // ---- the section ----
  work: 'Work',

  // ---- top bar ----
  energy: 'Energy',
  energyLow: 'Low',
  energyMedium: 'Medium',
  energyHigh: 'High',
  justOneThing: 'Just one thing',
  /** "Agent is carrying N · M alerts" (spec). */
  agentPill: (carrying: number, alerts: number) => `Agent is carrying ${carrying} · ${alerts} alerts`,
  searchWork: 'Search work', // ours

  // ---- brain-dump bar ----
  brainDump: 'Brain dump',
  brainDumpPlaceholder: 'Brain dump: type and press Enter', // ours

  // ---- focus rail and editor ----
  focusLine: (n: number, label: string) => `${n}. ${label}`,
  focusClearedCount: (cleared: number, total: number) => `${cleared}/${total} cleared`,
  noFocusLines: 'No focus lines today.', // ours
  edit: 'Edit',
  saveFocus: 'Save focus', // ported
  cancel: 'Cancel',
  focusChanged: "Today's note changed. Look again.", // ours (FOCUS_CHANGED)
  writeOneLine: 'Write at least one line.', // ported
  focusOneLine: 'A focus line is one line.', // ours
  focusMaxLines: 'At most 20 focus lines.', // ours

  // ---- views ----
  viewNow: 'Now',
  viewFlow: 'Flow',
  viewProjects: 'Projects map',
  viewToday: 'Today',
  viewFloor: 'On the floor',
  viewQueues: 'Your queues',
  viewAgent: 'Agent queue',
  viewStuck: 'Stuck',
  viewWins: 'Wins',
  viewAlerts: 'Alerts',
  viewEverything: 'Everything',
  viewTickets: 'Tickets',

  // ---- empty states (spec) ----
  nothingWaiting: 'Nothing is waiting on you',
  focusCleared: (n: number) => `Focus ${n} cleared`,
  allQuiet: 'All quiet',
  focusLinksNothing: 'No work is linked to this focus line yet.', // ported
  focusNothingYours: (n: number) => `Nothing in focus ${n} is waiting on you.`, // ours
  showEverythingAgain: 'Show everything again', // ported

  // ---- Now ----
  energyMinutes: (energy: string, minutes: number) => `${energy} energy · ~${minutes} min`, // ours, ported
  firstTinyStep: 'First tiny step',
  blockedOn: 'Blocked on',
  hypothesis: 'Hypothesis',
  confidenceOf: (confidence: string) => `${confidence} confidence`,
  whereYouLeftOff: 'Where you left off',
  lastTouchedDays: (n: number) => `Last touched ${days(n)} ago`, // ported
  stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
  startTogether: 'Start together',
  makeItSmaller: 'Make it smaller',
  notNow: 'Not now',
  details: 'Details',
  everyStepDone: 'Every step is done.', // ours
  close: 'Close',
  deskSays: (status: string) => `Desk says ${status}`,
  upNext: 'Up next',
  hiddenOnPurpose: (n: number) => `+${n} more hidden on purpose`,
  agentIsCarrying: 'Agent is carrying',
  parkedDumps: 'Parked dumps need you',
  nextMeeting: 'Next meeting',
  deadlines: 'Deadlines',
  daysLeft: (n: number) => days(n),
  alerts: 'Alerts',
  wins: 'Wins',

  // ---- step actions ----
  send: 'Send',
  typeTheAnswer: 'Type the answer', // ours
  done: 'Done',
  whatYouFound: 'What you found', // ours
  approve: 'Approve',
  approveArmed: 'Press again to approve', // spec ("our wording")
  notBefore: 'Not before',
  decline: 'Decline',
  reasonOptional: 'Reason (optional)', // ours
  withdraw: 'Withdraw',
  runNow: 'Run now',
  stepChanged: 'This step changed. Look again.',
  undo: 'Undo',
  undoDone: 'Marked done', // ours
  undoDeclined: 'Declined', // ours
  undoApproved: 'Approved', // ours

  // ---- Flow ----
  laneYou: 'You',
  laneAgent: 'Agent',
  laneOthers: 'Others',
  colNotStarted: 'Not started',
  colReady: 'Ready',
  colDoing: 'Doing',
  colParked: 'Waiting / parked',
  colDone: 'Done (14 days)',
  youDoing: (n: number, limit: number) => `You: ${n} / ${limit}`,
  overloaded: 'Overloaded',
  allAreas: 'All areas', // ported
  daysQuiet: (n: number) => `${days(n)} quiet`, // ported
  noArea: 'No area', // ours

  // ---- Projects map ----
  openCount: (n: number) => `${n} open`,
  percentDone: (p: number) => `${p}% done`,
  nextForYou: (text: string) => `Next for you: ${text}`, // ours, ported wording

  // ---- Today ----
  morningBrief: 'Morning brief', // ported
  wrapUp: 'Wrap-up', // ported

  // ---- On the floor ----
  floorSummary: (n: number, places: number, collected: number) =>
    `${n} to gather in ${places} places · ${collected} collected`, // ported
  generalList: 'General list',
  collected: 'Collected',
  place: 'Place',
  what: 'What',
  add: 'Add',
  printChecklist: 'Print checklist',
  nothingOnFloor: 'Nothing to gather on the floor', // ported
  anywhere: 'Anywhere', // ported
  floorChanged: 'This floor item changed. Look again.',

  // ---- Your queues ----
  queueAnswer: 'Answer',
  queueDo: 'Do',
  queueApprove: 'Approve',
  queueAgent: 'Agent running',
  laterSteps: (n: number) => `+${n} later steps waiting`, // ported
  queued: 'Queued',

  // ---- Agent queue ----
  workingOn: 'Working on',
  failed: 'Failed',
  retry: 'Retry',
  agentActs: 'Agent acts on my approvals',
  notBeforeTime: (time: string) => `Not before ${time}`,
  waitingForAgent: 'Waiting for the agent', // ours

  // ---- Stuck ----
  blockedQuiet: 'Blocked and quiet for 7+ days',
  waitingOnSomeone: 'Waiting on someone',
  failedRuns: 'Failed agent runs',
  nothingStuck: 'Nothing is stuck', // ours

  // ---- Wins ----
  stepsDone14: 'Steps done in 14 days',
  itemsClosed14: 'Items closed in 14 days',
  objectsChanged14: 'Objects changed in 14 days',
  changedToday: 'Changed today',
  whatGotDone: 'What got done',
  noStreaks: 'No streaks to break. This only grows.',
  winClosed: 'Closed',

  // ---- Alerts ----
  severityCritical: 'Critical',
  severityWarning: 'Warning',
  severityInfo: 'Info',
  clearedAlerts: 'Cleared', // ours
  sourceNotFresh: (source: string, time: string) => `${source} isn't fresh: last report ${time}`, // ours
  checkNow: 'Check now',
  pickMonitoringFolder: 'Pick a monitoring folder in Settings > Work.', // ours

  // ---- Everything ----
  colType: 'Type',
  colTicketId: 'Ticket ID',
  colTitle: 'Title',
  colArea: 'Area',
  colStage: 'Stage',
  colTurn: 'Whose turn',
  colPriority: 'Priority',
  colQuietDays: 'Quiet days',
  colScore: 'Score',

  // ---- item panel ----
  openTicket: 'Open ticket',
  waitingOn: 'Waiting on',
  findings: 'Findings',
  confidence: 'Confidence',
  verified: 'Verified',
  assumed: 'Assumed',
  toRaiseConfidence: 'To raise confidence',
  floorItems: 'Floor items',
  addNote: 'Add note',
  askTheAgent: 'Ask the agent',
  resolutionNote: 'Resolution note',
  activity: 'Activity',
  showAll: 'Show all', // ours

  // ---- focus session, Make it smaller, Keep on top ----
  stepDone: 'Step done',
  pause: 'Pause',
  tooBig: 'Too big',
  tellTheAgent: 'Tell the agent what you see',
  timesUp: "Time's up", // ours
  pausedCapture: (ref: string) => `[${ref}] paused a focus session here`, // ported
  sessionCapture: (ref: string, text: string) => `[${ref}] ${text}`, // ported
  replaceStep: 'Replace the step with these', // ours
  askBreakDown: 'Ask the agent to break it down',
  /** The spec's prefix: `Break down <item> step n: ...`. */
  breakDown: (ref: string, n: number, text: string) => `Break down ${ref} step ${n}: ${text}`,
  twoMinutes: '~2 min', // ported
  splitGet: 'Get what you need for this step', // ours
  splitWrite: 'Write down what you found', // ours
  keepOnTop: 'Keep on top',

  // ---- settings (T17) ----
  alertFolder: 'Alert folder',
  alertIntervals: 'Alert intervals',
  addAlertType: 'Add the Alert type',
  alertTypeExists: 'The Alert type exists.', // ours
} as const
