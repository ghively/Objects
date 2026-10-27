/**
 * The M7 annotation syntax: an HTML comment on a line of its own that carries
 * the block options plain Markdown cannot (plan "Annotation syntax").
 *
 *   <!-- block: color=bg-blue align=center -->   leaf options for the next block
 *   <!-- toggle open -->  <!-- group -->  <!-- columns widths=40,60 -->   container open
 *   <!-- column -->                               columns separator
 *   <!-- /toggle -->  <!-- /group -->  <!-- /columns -->                  container close
 *
 * Pure: no Tiptap. The parser is lenient about spaces and the case of names,
 * keeps every option's exact text (`raw`), and returns `null` for anything
 * that is not an annotation so the line stays an ordinary comment.
 */
import { THEME_COLORS } from '@/theme/palette'

export type ContainerName = 'toggle' | 'group' | 'columns'

export type Option = { key: string; value: string | true; raw: string }

export type Annotation = {
  type: 'leaf' | 'open' | 'separator' | 'close'
  name?: ContainerName
  options: Option[]
}

/** What a block (or container) can be, for the "Applies to" column. */
export type OptionTarget =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'orderedList'
  | 'blockquote'
  | 'code'
  | 'table'
  | 'math'
  | 'image'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'file'
  | 'objectEmbed'
  | 'bookmark'
  | 'toggle'
  | 'group'
  | 'columns'

export type KnownOption = {
  key: string
  /** `'flag'` for a bare key; otherwise the pattern a known value matches. */
  value: 'flag' | RegExp
  appliesTo: readonly OptionTarget[]
  /** Canonical writing position (the option table's order). */
  order: number
  /** Always written double-quoted (caption is "quoted text"). */
  quoted?: boolean
}

const COLOR_VALUE = new RegExp(`^(?:text|bg)-(?:${THEME_COLORS.join('|')})$`)

/** The option table of the plan's Global Constraints, in canonical order. */
export const KNOWN_OPTIONS: readonly KnownOption[] = (
  [
    { key: 'small', value: 'flag', appliesTo: ['paragraph'] },
    {
      key: 'color',
      value: COLOR_VALUE,
      appliesTo: ['paragraph', 'heading', 'list', 'blockquote', 'math', 'group', 'columns'],
    },
    {
      key: 'align',
      value: /^(?:center|right)$/,
      appliesTo: ['paragraph', 'heading', 'math', 'group', 'image', 'pdf', 'video', 'objectEmbed'],
    },
    { key: 'icon', value: /^\S(?:.*\S)?$/, appliesTo: ['paragraph', 'heading'] },
    { key: 'quote', value: /^standout$/, appliesTo: ['blockquote'] },
    { key: 'list', value: /^(?:alphabetical|roman)$/, appliesTo: ['orderedList'] },
    { key: 'wrap', value: 'flag', appliesTo: ['code'] },
    { key: 'lock', value: 'flag', appliesTo: ['code'] },
    { key: 'preview', value: /^(?:edit|split|display)$/, appliesTo: ['code'] },
    { key: 'header-column', value: 'flag', appliesTo: ['table'] },
    { key: 'no-header-row', value: 'flag', appliesTo: ['table'] },
    { key: 'width', value: /^\d+$/, appliesTo: ['image', 'pdf', 'video', 'objectEmbed'] },
    { key: 'height', value: /^\d+$/, appliesTo: ['image', 'pdf', 'video', 'objectEmbed'] },
    { key: 'caption', value: /^[^\r\n]*$/, appliesTo: ['image', 'pdf', 'video', 'audio', 'file'], quoted: true },
    { key: 'view', value: /^(?:inline|smallCard|wideCard|embed)$/, appliesTo: ['objectEmbed'] },
    { key: 'bookmark', value: 'flag', appliesTo: ['bookmark'] },
    { key: 'open', value: 'flag', appliesTo: ['toggle'] },
    { key: 'widths', value: /^\d+(?:,\d+)*$/, appliesTo: ['columns'] },
    { key: 'layout', value: /^grid$/, appliesTo: ['columns'] },
  ] as Omit<KnownOption, 'order'>[]
).map((o, order) => ({ ...o, order }))

const KNOWN_BY_KEY = new Map(KNOWN_OPTIONS.map((o) => [o.key, o]))

export function knownOption(key: string): KnownOption | undefined {
  return KNOWN_BY_KEY.get(key)
}

/** True when the option's key is known and its value is one the table allows. */
export function isKnownValue(opt: Pick<Option, 'key' | 'value'>): boolean {
  const known = KNOWN_BY_KEY.get(opt.key)
  if (!known) return false
  if (known.value === 'flag') return opt.value === true
  return typeof opt.value === 'string' && known.value.test(opt.value)
}

// ---------------------------------------------------------------------------
// Parsing

/** Up to 3 spaces, `<!--`, a body without `-->`, `-->`, trailing blanks, one optional line end. */
const LINE = /^ {0,3}<!--((?:(?!-->)[^\r\n])*)-->[ \t]*(?:\r\n|\n|\r)?$/
const KEY = /[a-z][a-zA-Z0-9-]*/y
const BARE = /[A-Za-z0-9_.,:#/+-]+/y
const BLANK = /[ \t]+/y
const CONTAINERS: readonly ContainerName[] = ['toggle', 'group', 'columns']

function parseOptions(text: string): Option[] | null {
  const options: Option[] = []
  let i = 0
  const skipBlanks = () => {
    BLANK.lastIndex = i
    if (BLANK.test(text)) i = BLANK.lastIndex
  }
  skipBlanks()
  while (i < text.length) {
    const start = i
    KEY.lastIndex = i
    const km = KEY.exec(text)
    if (!km) return null
    i = KEY.lastIndex
    let value: string | true = true
    if (text[i] === '=') {
      i++
      if (text[i] === '"') {
        i++
        let v = ''
        for (;;) {
          if (i >= text.length) return null
          const ch = text[i]
          if (ch === '"') {
            i++
            break
          }
          if (ch === '\\') {
            const next = text[i + 1]
            if (next !== '"' && next !== '\\') return null
            v += next
            i += 2
            continue
          }
          v += ch
          i++
        }
        value = v
      } else {
        BARE.lastIndex = i
        const vm = BARE.exec(text)
        if (!vm) return null
        value = vm[0]
        i = BARE.lastIndex
      }
    }
    options.push({ key: km[0], value, raw: text.slice(start, i) })
    if (i < text.length && text[i] !== ' ' && text[i] !== '\t') return null
    skipBlanks()
  }
  return options
}

/**
 * Parse one line (with or without its line end) as an annotation; `null` for
 * an ordinary comment, an unknown container name or anything malformed.
 */
export function parseAnnotation(line: string): Annotation | null {
  const m = LINE.exec(line)
  if (!m) return null
  const body = m[1].replace(/^[ \t]+|[ \t]+$/g, '')
  const lower = body.toLowerCase()

  if (lower.startsWith('block:')) {
    const options = parseOptions(body.slice('block:'.length))
    return options ? { type: 'leaf', options } : null
  }
  if (lower === 'column') return { type: 'separator', options: [] }
  if (lower.startsWith('/')) {
    const name = CONTAINERS.find((c) => c === lower.slice(1))
    return name ? { type: 'close', name, options: [] } : null
  }
  const word = /^[A-Za-z]+/.exec(body)?.[0] ?? ''
  const name = CONTAINERS.find((c) => c === word.toLowerCase())
  if (!name) return null
  const rest = body.slice(word.length)
  if (rest !== '' && rest[0] !== ' ' && rest[0] !== '\t') return null
  const options = parseOptions(rest)
  return options ? { type: 'open', name, options } : null
}

// ---------------------------------------------------------------------------
// Formatting

const BARE_WHOLE = /^[A-Za-z0-9_.,:#/+-]+$/

function formatValue(value: string, quoted: boolean): string {
  // A value never holds a line break, and never `-->`, which would end the comment early (our rule).
  const v = value.replace(/\r\n?|\n/g, ' ').replace(/-->/g, '-- >')
  if (!quoted && BARE_WHOLE.test(v)) return v
  return `"${v.replace(/[\\"]/g, (c) => `\\${c}`)}"`
}

/** One option in canonical form. */
export function formatOption(opt: Pick<Option, 'key' | 'value'>): string {
  if (opt.value === true) return opt.key
  return `${opt.key}=${formatValue(opt.value, Boolean(KNOWN_BY_KEY.get(opt.key)?.quoted))}`
}

/** An option with its canonical `raw`, for code that builds options from scratch. */
export function makeOption(key: string, value: string | true): Option {
  return { key, value, raw: formatOption({ key, value }) }
}

/** Known options in the table's order (stable), then unknown ones in their original order. */
export function canonicalOrder(options: readonly Option[]): Option[] {
  const known = options.filter((o) => KNOWN_BY_KEY.has(o.key))
  const unknown = options.filter((o) => !KNOWN_BY_KEY.has(o.key))
  known.sort((a, b) => KNOWN_BY_KEY.get(a.key)!.order - KNOWN_BY_KEY.get(b.key)!.order)
  return [...known, ...unknown]
}

/** The canonical line for `a`, without a line end. Unknown options keep their exact text. */
export function formatAnnotation(a: Annotation): string {
  if (a.type === 'separator') return '<!-- column -->'
  if (a.type === 'close') return `<!-- /${a.name} -->`
  const opts = canonicalOrder(a.options).map((o) => (KNOWN_BY_KEY.has(o.key) ? formatOption(o) : o.raw))
  if (a.type === 'leaf') return `<!-- block:${opts.map((o) => ` ${o}`).join('')} -->`
  return `<!-- ${[a.name, ...opts].join(' ')} -->`
}

const valueKey = (o: Option) => (o.value === true ? `${o.key}` : `${o.key}=${o.value}`)

/** Same options: known ones compared as a set (order-insensitive), unknown ones in order. */
export function optionsEqual(a: readonly Option[], b: readonly Option[]): boolean {
  const split = (opts: readonly Option[]) => {
    const known = opts.filter((o) => KNOWN_BY_KEY.has(o.key)).map(valueKey).sort()
    const unknown = opts.filter((o) => !KNOWN_BY_KEY.has(o.key)).map(valueKey)
    return [known, unknown]
  }
  const [ka, ua] = split(a)
  const [kb, ub] = split(b)
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i])
  return same(ka, kb) && same(ua, ub)
}

// ---------------------------------------------------------------------------
// Inline math (rule 6) and embed lines (rule 7)

export type InlineMath = { start: number; end: number; text: string }

const isBlank = (ch: string | undefined) => ch === undefined || /\s/.test(ch)
const isDigit = (ch: string | undefined) => ch !== undefined && ch >= '0' && ch <= '9'

/**
 * Every inline formula in `text`, Pandoc's rule: the opening `$` is followed by
 * a non-space, the closing `$` is preceded by a non-space and not followed by
 * a digit; `\$` is a literal dollar; `$$` never starts an inline formula.
 * `start`/`end` span the delimiters; `text` is what lies between them.
 */
export function findInlineMath(text: string): InlineMath[] {
  const found: InlineMath[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch !== '$') {
      i++
      continue
    }
    if (text[i + 1] === '$') {
      // `$$` never opens; skip the whole run of dollars.
      while (text[i] === '$') i++
      continue
    }
    if (isBlank(text[i + 1])) {
      i++
      continue
    }
    let close = -1
    for (let j = i + 1; j < text.length; j++) {
      const c = text[j]
      if (c === '\\') {
        j++
        continue
      }
      if (c === '$' && !isBlank(text[j - 1]) && !isDigit(text[j + 1])) {
        close = j
        break
      }
    }
    if (close < 0) {
      i++
      continue
    }
    found.push({ start: i, end: close + 1, text: text.slice(i + 1, close) })
    i = close + 1
  }
  return found
}

export type AttachmentKind = 'image' | 'pdf' | 'audio' | 'video' | 'file'

const KIND_BY_EXT: Record<string, AttachmentKind> = {}
for (const [kind, exts] of [
  ['image', 'png jpg jpeg gif webp svg'],
  ['pdf', 'pdf'],
  ['audio', 'mp3 wav m4a ogg oga flac aac opus'],
  ['video', 'mp4 webm mov m4v ogv'],
] as const) {
  for (const ext of exts.split(' ')) KIND_BY_EXT[ext] = kind
}

/** Task 2's kinds by extension (`media.kind_of`); anything else is `file`. */
export function attachmentKind(name: string): AttachmentKind {
  const ext = /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''
  return KIND_BY_EXT[ext] ?? 'file'
}

export type EmbedLine =
  | { kind: 'image'; alt: string; src: string }
  | { kind: 'media'; mediaKind: AttachmentKind; target: string; label: string | null }
  | { kind: 'objectEmbed'; target: string; label: string | null }

const MD_IMAGE = /^!\[([^\]\r\n]*)\]\((\S+?)(?:[ \t]+"[^"\r\n]*")?\)$/
const WIKI_EMBED = /^!\[\[([^\]|\r\n]+)(?:\|([^\]\r\n]*))?\]\]$/
const FILE_EXT = /\.([A-Za-z0-9]{1,10})$/

function lineText(raw: string): string | null {
  const text = raw.replace(/^ {0,3}/, '').replace(/[ \t\r\n]+$/, '')
  return /[\r\n]/.test(text) ? null : text
}

/**
 * Rule 7: a paragraph whose whole text is one `![alt](src)` is an image block;
 * one `![[target]]` (or `![[target|label]]`) is a media block when the target
 * has an extension other than `.md`, otherwise an object embed. `null` otherwise.
 */
export function classifyEmbedLine(raw: string): EmbedLine | null {
  const text = lineText(raw)
  if (text === null) return null
  const img = MD_IMAGE.exec(text)
  if (img) return { kind: 'image', alt: img[1], src: img[2] }
  const wiki = WIKI_EMBED.exec(text)
  if (!wiki) return null
  const target = wiki[1]
  const label = wiki[2] ?? null
  const ext = FILE_EXT.exec(target)?.[1]?.toLowerCase()
  if (ext && ext !== 'md') return { kind: 'media', mediaKind: attachmentKind(target), target, label }
  return { kind: 'objectEmbed', target, label }
}

const ONE_LINK = /^\[([^\]\r\n]*)\]\(([^)\s]+)(?:[ \t]+"[^"\r\n]*")?\)$/

/** A paragraph that holds exactly one Markdown link (the web link block's shape), or `null`. */
export function singleLink(raw: string): { title: string; href: string } | null {
  const text = lineText(raw)
  const m = text === null ? null : ONE_LINK.exec(text)
  return m ? { title: m[1], href: m[2] } : null
}
