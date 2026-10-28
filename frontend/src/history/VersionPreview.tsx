/**
 * One saved version's preview in the Version History dialog (M8 Task 5): the body in M1's
 * read-only `Editor` and a "Properties" section (`VersionHistory.propertiesSection`) listing the
 * version's frontmatter values as text.
 *
 * Our choices (listed for Gene; the trimmed reference does not show Capacities' preview):
 * - The properties are the version's own frontmatter keys, minus the keys the app keeps
 *   (`id`, `type`, `template`, `title`, `createdAt`, `lastUpdated`), named by the current type's
 *   property definitions when the key matches one, else by the key itself.
 * - The block count is the number of top-level Markdown blocks of the body (blank lines aside).
 * - The frontmatter is read with a small line reader (no YAML library in the app): scalars,
 *   quoted strings, `- item` lists and `[a, b]` lists show as text; nested maps show their lines.
 */
import { Editor } from '@/editor/Editor'
import { splitBlocks } from '@/editor/blocks'
import { typeOf, useLinkIndex } from '@/links/linkIndex'

/** Frontmatter keys the app keeps, never counted or shown as properties (our choice). */
const KEPT_KEYS = new Set(['id', 'type', 'template', 'title', 'createdAt', 'lastUpdated'])

export interface VersionProperty {
  key: string
  /** The value as display text ('' when empty). */
  value: string
}

export interface ParsedVersion {
  /** The frontmatter lines (without the fences); null when the text has none. */
  frontmatter: string[] | null
  body: string
}

/** Split a version's text (`\n` line ends, no BOM) into its frontmatter lines and body. */
export function splitVersionText(text: string): ParsedVersion {
  const t = text.replace(/\r\n?/g, '\n')
  if (!t.startsWith('---\n')) return { frontmatter: null, body: text }
  const lines = t.split('\n')
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---' || lines[i] === '...') {
      const body = lines.slice(i + 1).join('\n')
      return { frontmatter: lines.slice(1, i), body }
    }
  }
  return { frontmatter: null, body: text }
}

function unquote(s: string): string {
  const v = s.trim()
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1)
  }
  return v
}

function inlineList(s: string): string[] | null {
  const v = s.trim()
  if (!v.startsWith('[') || !v.endsWith(']')) return null
  const inner = v.slice(1, -1).trim()
  if (!inner) return []
  return inner.split(',').map(unquote).filter((x) => x !== '')
}

/** The version's top-level frontmatter keys and values (the kept keys left out). */
export function versionProperties(text: string): VersionProperty[] {
  const { frontmatter } = splitVersionText(text)
  if (!frontmatter) return []
  const out: { key: string; head: string; rest: string[] }[] = []
  for (const line of frontmatter) {
    const m = /^([^\s#:-][^:]*):(?:\s+(.*))?$/.exec(line)
    if (m && !/^\s/.test(line)) {
      out.push({ key: m[1].trim(), head: (m[2] ?? '').trim(), rest: [] })
    } else if (out.length && line.trim() !== '' && !line.trimStart().startsWith('#')) {
      out[out.length - 1].rest.push(line)
    }
  }
  return out
    .filter((e) => !KEPT_KEYS.has(e.key))
    .map(({ key, head, rest }) => {
      if (head && head !== '|' && head !== '>' && head !== '|-' && head !== '>-') {
        const list = inlineList(head)
        return { key, value: list ? list.join(', ') : unquote(head) }
      }
      if (rest.length && rest.every((l) => /^\s*- /.test(l) || /^\s*-$/.test(l))) {
        return { key, value: rest.map((l) => unquote(l.replace(/^\s*-\s?/, ''))).filter(Boolean).join(', ') }
      }
      return { key, value: rest.map((l) => l.trim()).join(' ') }
    })
}

/** The number of top-level blocks of a body (blank lines aside). */
export function countBlocks(body: string): number {
  return splitBlocks(body).filter((b) => b.kind !== 'space' && b.raw.trim() !== '').length
}

/** `{blocks, properties}` of a version's text, for the list's counts. */
export function versionCounts(text: string): { blocks: number; properties: number } {
  return { blocks: countBlocks(splitVersionText(text).body), properties: versionProperties(text).length }
}

/** `VersionHistory.blockCount`: "{count} block | {count} blocks". */
export function blockCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'block' : 'blocks'}`
}

/** `VersionHistory.propertyCount`: "{count} property | {count} properties". */
export function propertyCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'property' : 'properties'}`
}

/** `VersionHistory.propertiesSection` */
export const PROPERTIES_SECTION = 'Properties'

function typeIdOf(text: string): string | null {
  const { frontmatter } = splitVersionText(text)
  for (const line of frontmatter ?? []) {
    const m = /^type:\s*(.*)$/.exec(line)
    if (m) return unquote(m[1]) || null
  }
  return null
}

export function VersionPreview({ path, versionId, text }: { path: string; versionId: string; text: string }) {
  useLinkIndex((s) => s.types)
  const { body } = splitVersionText(text)
  const props = versionProperties(text)
  const defs = typeOf(typeIdOf(text))?.propertyDefinitions ?? []
  const nameOf = (key: string) => defs.find((d) => d.key === key)?.name ?? key
  return (
    <div className="flex flex-col gap-4" data-testid="version-preview">
      <div className="version-preview-body">
        <Editor
          key={versionId}
          path={path}
          body={body}
          version=""
          readOnly
          onSaved={() => undefined}
          onConflict={() => undefined}
        />
      </div>
      {props.length > 0 && (
        <section aria-label={PROPERTIES_SECTION} className="border-t pt-3">
          <h3 className="mb-2 text-sm font-semibold">{PROPERTIES_SECTION}</h3>
          <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1 text-sm">
            {props.map((p) => (
              <div key={p.key} className="contents">
                <dt className="text-muted-foreground">{nameOf(p.key)}</dt>
                <dd className="min-w-0 break-words">{p.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  )
}

export default VersionPreview
