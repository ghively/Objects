// M25: the "Source" line under an imported object's properties (design section 1). It reads the
// `importSource` system block and offers "Open original" (the url when it is a web link, else the
// kept file) and "Show file" (the kept original). Hidden when the object has no block.
// M31: a version that is a git commit sha shows as "commit <first 7>", and a file that differed from
// its commit when imported (`uncommitted: true`) says so.
import { api } from '@/api/client'
import type { ImportSourceBlock } from '@/api/types'
import { IMPORT_TEXT as T } from '@/import/text'

const NAMES: Record<string, string> = {
  sharepoint: 'SharePoint',
  notion: 'Notion',
  wiki: 'the wiki',
  obsidian: 'Obsidian',
  anytype: 'Anytype',
  files: 'a folder of files',
  markdown: 'a Markdown folder',
}

/** The block, when `value` is a usable `importSource` (a map with a system and an id). */
export function importSourceOf(value: unknown): ImportSourceBlock | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (typeof v.system !== 'string' || v.id === undefined || v.id === null) return null
  const text = (k: string) => (typeof v[k] === 'string' && v[k] !== '' ? (v[k] as string) : undefined)
  return {
    system: v.system,
    id: String(v.id),
    url: text('url'),
    version: text('version'),
    author: text('author'),
    created: text('created'),
    modified: text('modified'),
    original: text('original'),
    contentHash: text('contentHash'),
    batch: text('batch'),
    importedAt: text('importedAt'),
  }
}

const isCommit = (v: string | undefined): boolean => !!v && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(v)

const isWeb = (url: string | undefined): url is string => !!url && /^https?:\/\//i.test(url)

function day(iso: string | undefined): string | null {
  const m = iso?.match(/^\d{4}-\d{2}-\d{2}/)
  return m ? m[0] : null
}

export function ImportSourceLine({ source }: { source: unknown }) {
  const s = importSourceOf(source)
  if (!s) return null
  const web = isWeb(s.url) ? s.url : undefined
  const canOpen = !!web || !!s.original
  const open = () => {
    if (web) window.open(web, '_blank', 'noopener,noreferrer')
    else if (s.original) void api.openAttachment(s.original).catch(() => undefined)
  }
  const show = () => {
    if (s.original) void api.revealImportOriginal(s.original).catch(() => undefined)
  }
  const uncommitted = (source as Record<string, unknown>).uncommitted === true
  const version = isCommit(s.version)
    ? T.commit(s.version as string)
    : s.version && !s.version.startsWith('sha256:')
      ? `version ${s.version}`
      : null
  const bits = [s.author, day(s.modified) ? `modified ${day(s.modified)}` : null, version, uncommitted ? T.uncommitted : null]
    .filter(Boolean)
    .join(', ')
  return (
    <div
      role="group"
      aria-label={T.sourceHeading}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-1 text-[13px] text-fg-muted"
    >
      <span className="font-semibold text-fg">{T.sourceHeading}</span>
      <span>
        {T.importedFrom(NAMES[s.system] ?? s.system)}
        {bits ? ` (${bits})` : ''}
      </span>
      {canOpen && (
        <button type="button" className="underline underline-offset-2 hover:text-fg" onClick={open}>
          {T.openOriginal}
        </button>
      )}
      {s.original && (
        <button type="button" className="underline underline-offset-2 hover:text-fg" onClick={show}>
          {T.showFile}
        </button>
      )}
    </div>
  )
}
