// The import dialog's strings. The behaviour catalog doesn't describe an import dialog, so every
// label here is our string (contract: docs/superpowers/plans/2026-11-05-m15-importers.md).
import type { ImportPhase, ImportResult, ImportSkipReason, ImportSourceKind } from '@/api/types'

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export const IMPORT_TEXT = {
  title: 'Import from another app',
  description: 'Object reads the export and shows what it will import. Nothing is written until you choose Import.',
  source: 'Zip file or folder',
  sourcePlaceholder: 'Full path of the .zip file or folder',
  kind: 'Exported from',
  kinds: { auto: 'Detect automatically', notion: 'Notion', obsidian: 'Obsidian', anytype: 'Anytype' } as Record<
    ImportSourceKind | 'auto',
    string
  >,
  preview: 'Preview',
  reading: 'Reading…',
  back: 'Back',
  close: 'Close',

  // The preview summary.
  summaryHeading: 'What will be imported',
  /** The preview's summary line. */
  summary: (objects: number, types: number, attachments: number) =>
    `${objects} objects, ${types} types, ${attachments} attachments`,
  sourceLine: (app: string, container: 'zip' | 'folder', detected: boolean) =>
    `${app} export, ${container === 'zip' ? 'a .zip file' : 'a folder'}${detected ? ' (detected)' : ''}`,
  properties: (n: number) => plural(n, 'property', 'properties'),
  links: (resolved: number, total: number) => `${resolved} of ${total} links will resolve`,
  attachments: (n: number, size: string) => `${plural(n, 'attachment', 'attachments')} (${size})`,
  renamed: (n: number) => `${plural(n, 'title repeats', 'titles repeat')}; those files get a number`,
  skippedCount: (n: number) => `${plural(n, 'item', 'items')} skipped`,
  skippedHeading: 'Skipped items',
  skippedShown: (shown: number, total: number) => `The first ${shown} of ${total}. The Import report lists them all.`,
  warningsHeading: 'Warnings',
  updating: 'Updating preview…',
  reasons: {
    unsafePath: 'Unsafe path',
    symlink: 'Link to another file',
    encrypted: 'Encrypted',
    tooLarge: 'Too large',
    damaged: 'Damaged',
    nestedArchive: 'Zip inside a zip',
    unsupported: 'Not supported',
    appSettings: "The other app's settings",
    notUtf8: 'Not UTF-8 text',
    missingAttachment: 'Missing file',
    unresolvedLink: 'Link to a page not in the export',
    databaseLink: 'Link to a database',
    valueNotConverted: "Value doesn't fit",
    userSkipped: 'Left out by you',
    emptyFile: 'Empty file',
  } as Record<ImportSkipReason, string>,

  // The mapping step.
  mappings: 'Review mappings',
  typesFrom: 'Make types from',
  typesFromFolder: 'Top-level folders',
  typesFromKey: 'A frontmatter key',
  typesFromNone: 'Nothing (everything is a Page)',
  typeKey: 'Frontmatter key',
  typeKeyOption: (key: string, files: number) => `${key} (${plural(files, 'file', 'files')})`,
  types: 'Types',
  typeName: 'Name',
  pluralName: 'Plural name',
  objectCount: (n: number) => plural(n, 'object', 'objects'),
  skip: "Don't import",
  existingType: 'Add to',
  newType: 'A new type',
  showProperties: (n: number) => `Properties (${n})`,
  noProperties: 'No properties.',
  propertyName: 'Name',
  propertyKind: 'Kind',
  guessed: (kind: string) => `${kind} (guessed)`,
  multiple: 'Multiple values',
  samples: 'Examples:',
  unconvertible: (n: number) => `${plural(n, "value doesn't", "values don't")} fit this kind and will be left out`,
  fills: (field: string) => `Fills ${field}`,

  // The target.
  target: 'Import into',
  newSpace: 'A new space',
  thisSpace: 'This space',
  thisSpaceNamed: (name: string) => `This space (${name})`,
  thisSpaceNote: 'The objects are added to the space that is open now. Nothing in it is changed or overwritten.',
  name: 'Name',
  location: 'Location',
  import: 'Import',

  // Progress.
  importing: 'Importing…',
  progress: 'Import progress',
  importingCount: (done: number, total: number) => `Importing… ${done} / ${total}`,
  /** What a screen reader hears: on a new phase and every tenth of the way (the line above changes on every poll). */
  progressStatus: (phase: string, done: number, total: number) => `${phase}: ${done} of ${total}`,
  phases: {
    preparing: 'Preparing',
    types: 'Making types',
    attachments: 'Copying attachments',
    objects: 'Writing objects',
    report: 'Writing the Import report',
    done: 'Done',
    failed: 'Failed',
    cancelled: 'Stopped',
  } as Record<ImportPhase, string>,
  stop: 'Stop import',
  stopping: 'Stopping…',
  cancel: 'Cancel',

  // The finish.
  finished: 'Import finished. Switch to the new space now?',
  finishedHere: 'Import finished.',
  switchNow: 'Switch space',
  later: 'Later',
  openReport: 'Open import report',
  stopped: 'The import stopped. What was written so far is kept.',
  failed: 'The import failed. What was written so far is kept.',
  result: (r: Pick<ImportResult, 'objects' | 'types' | 'attachments' | 'tags'>) =>
    `${plural(r.objects, 'object', 'objects')}, ${plural(r.types, 'type', 'types')}, ` +
    `${plural(r.attachments, 'attachment', 'attachments')}, ${plural(r.tags, 'tag', 'tags')}`,
  resultSkipped: (n: number) => `${plural(n, 'item was', 'items were')} skipped; the Import report lists them.`,

  // Errors.
  notFound: 'There is no file or folder at that path.',
  notZip: "That isn't a .zip file or a folder.",
  tooLarge: 'This export is larger than Object can import at once.',
  jobLost: 'The import is no longer running (Object was restarted).',
  previewExpired: 'The preview had expired, so Object read the export again. Check the review, then choose Import again.',
} as const
