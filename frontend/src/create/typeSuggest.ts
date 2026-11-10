/**
 * M29: the suggested type of a create row, ported 1:1 from `backend/objectapp/typesuggest.py`
 * (both run the parity fixture `__fixtures__/suggest-cases.json`; the Python module's docstring
 * states the algorithm step by step). Context and name patterns only: no AI, no network, nothing
 * sent anywhere; it runs per keystroke.
 *
 * - Whitespace is JavaScript's `\s` set; a character is a code point (`for...of`).
 * - The name is normalised once: `trim()`, then `toLowerCase()`; inner spaces are kept.
 * - A name over `NAME_MAX` (300) code points, counted before the trim, matches no pattern (so a
 *   pasted page of text never runs one).
 * - A pattern is valid when it is a string of 1-100 characters and either exactly one token
 *   (`{ip}`, `{cidr}`, `{fqdn}`, `{version}`; case-sensitive) or a glob with no `{` or `}` anywhere
 *   and no trailing unpaired `\`.
 * - Tokens test the whole normalised name with linear regexes (ASCII `[0-9]`, `[a-z]`).
 * - A glob (`*` any run of non-whitespace, `?` one non-whitespace character, `#` a digit 0-9, `@`
 *   a letter a-z, `\` escapes, anything else literal; tokenised on the lowercased pattern) is never
 *   compiled to a backtracking regex: it is matched by a state-set simulation, linear in the name's
 *   length times the pattern's.
 */
import type { TypeDef } from '@/api/types'

export const MAX_PATTERNS = 20
export const MAX_PATTERN = 100
/** The longest name (code points, untrimmed) that patterns are tried on (`typesuggest.NAME_MAX`). */
export const NAME_MAX = 300
export const TOKENS = ['{ip}', '{cidr}', '{fqdn}', '{version}'] as const

export const SUGGEST_TEXT = { suggested: 'Suggested' } // our string

export interface SuggestContext {
  /** The types this create row offers, in its order. */
  types: readonly TypeDef[]
  /** A relation property's allowed type ids (empty: any). */
  allowed?: readonly string[]
  /** The collection's or query's type ids. */
  scope?: readonly string[]
  /** The type used last in this space. */
  last?: string | null
}

/**
 * A compiled name pattern (the Python module's `NamePattern`): `source` is the pattern as written,
 * `test(name)` takes a name as typed (it is normalised here). Not a `RegExp`: a glob is matched by
 * the state-set simulation, never by a backtracking regex.
 */
export interface CompiledPattern {
  source: string
  test(name: string): boolean
}

const WS = /\s/

/** The name as patterns see it: trimmed, lowercased. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

// --- the four whole tokens (on the normalised name) ------------------------------------------

const OCTET = '(?:25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])'
const IPV4 = new RegExp(`^${OCTET}(?:\\.${OCTET}){3}$`)
const IPV6 = /^[0-9a-f:]+$/
const V4_PREFIX = /^(?:[0-9]|[12][0-9]|3[0-2])$/
const V6_PREFIX = /^(?:[0-9]|[1-9][0-9]|1[01][0-9]|12[0-8])$/
const FQDN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}[a-z]{2,63}$/
const VERSION = /^[^\s][\s\S]*\sv?[0-9]+(?:\.[0-9]+)*[a-z]?$/

const isIpv4 = (s: string) => IPV4.test(s)
const isIpv6 = (s: string) => IPV6.test(s) && s.split(':').length - 1 >= 2

function isCidr(s: string): boolean {
  const slash = s.lastIndexOf('/')
  if (slash < 0) return false
  const addr = s.slice(0, slash)
  const prefix = s.slice(slash + 1)
  if (isIpv4(addr)) return V4_PREFIX.test(prefix)
  if (isIpv6(addr)) return V6_PREFIX.test(prefix)
  return false
}

const TOKEN_TESTS = new Map<string, (s: string) => boolean>([
  ['{ip}', (s) => isIpv4(s) || isIpv6(s)],
  ['{cidr}', isCidr],
  ['{fqdn}', (s) => FQDN.test(s)],
  ['{version}', (s) => VERSION.test(s)],
])

// --- globs -----------------------------------------------------------------------------------

type GlobToken = { kind: 'star' | 'any' | 'digit' | 'letter' } | { kind: 'lit'; c: string }

/** The tokens of a glob, or null when it is invalid (a brace anywhere, a trailing `\`). */
function globTokens(pattern: string): GlobToken[] | null {
  if (pattern.includes('{') || pattern.includes('}')) return null
  const chars = Array.from(pattern.toLowerCase())
  const out: GlobToken[] = []
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (c === '\\') {
      if (i + 1 >= chars.length) return null
      out.push({ kind: 'lit', c: chars[i + 1] })
      i++
    } else if (c === '*') out.push({ kind: 'star' })
    else if (c === '?') out.push({ kind: 'any' })
    else if (c === '#') out.push({ kind: 'digit' })
    else if (c === '@') out.push({ kind: 'letter' })
    else out.push({ kind: 'lit', c })
  }
  return out
}

/**
 * The state-set simulation: state `i` means `t[0..i-1]` are matched. A STAR state loops on any
 * non-whitespace character and (closure) also lets the next state start.
 */
function globMatcher(t: GlobToken[]): (name: string) => boolean {
  const m = t.length
  const closure = (s: Uint8Array) => {
    for (let i = 0; i < m; i++) if (s[i] && t[i].kind === 'star') s[i + 1] = 1
    return s
  }
  const start = closure(Object.assign(new Uint8Array(m + 1), { 0: 1 }))
  return (name) => {
    let s = start
    for (const c of name) {
      const ws = WS.test(c)
      const next = new Uint8Array(m + 1)
      let any = false
      for (let i = 0; i < m; i++) {
        if (!s[i]) continue
        const tok = t[i]
        let advance = false
        if (tok.kind === 'star') {
          if (!ws) {
            next[i] = 1
            any = true
          }
        } else if (tok.kind === 'any') advance = !ws
        else if (tok.kind === 'digit') advance = c >= '0' && c <= '9'
        else if (tok.kind === 'letter') advance = c >= 'a' && c <= 'z'
        else if (tok.kind === 'lit') advance = tok.c === c
        if (advance) {
          next[i + 1] = 1
          any = true
        }
      }
      if (!any) return false
      s = closure(next)
    }
    return s[m] === 1
  }
}

// --- compile, match, suggest -----------------------------------------------------------------

/** Tests a normalised name. */
type NormTest = (normalized: string) => boolean

const MEMO_LIMIT = 512
const memo = new Map<string, { pattern: CompiledPattern; norm: NormTest } | null>()

function compileEntry(pattern: string): { pattern: CompiledPattern; norm: NormTest } | null {
  const hit = memo.get(pattern)
  if (hit !== undefined) return hit
  let entry: { pattern: CompiledPattern; norm: NormTest } | null = null
  const length = Array.from(pattern).length
  if (length >= 1 && length <= MAX_PATTERN) {
    let norm: NormTest | null = TOKEN_TESTS.get(pattern) ?? null
    if (!norm) {
      const tokens = globTokens(pattern)
      norm = tokens ? globMatcher(tokens) : null
    }
    if (norm) entry = { pattern: { source: pattern, test: (name) => norm(normalizeName(name)) }, norm }
  }
  if (memo.size >= MEMO_LIMIT) {
    const oldest = memo.keys().next().value
    if (oldest !== undefined) memo.delete(oldest)
  }
  memo.set(pattern, entry)
  return entry
}

/** The compiled `pattern`, or null when it is invalid. Memoised (512 kept). */
export function compilePattern(pattern: string): CompiledPattern | null {
  if (typeof pattern !== 'string') return null
  return compileEntry(pattern)?.pattern ?? null
}

/**
 * Whether `name` matches any valid pattern; invalid and non-string entries are ignored. A name
 * over `NAME_MAX` code points (untrimmed) matches none.
 */
export function matches(name: string, patterns: readonly unknown[]): boolean {
  if (!Array.isArray(patterns) || typeof name !== 'string') return false
  if (name.length > NAME_MAX && Array.from(name).length > NAME_MAX) return false
  const norm = normalizeName(name)
  for (const p of patterns) {
    if (typeof p !== 'string') continue
    const entry = compileEntry(p)
    if (entry && entry.norm(norm)) return true
  }
  return false
}

function unique(ids: Iterable<string>): string[] {
  return [...new Set(ids)]
}

/**
 * The suggested type ids for `name`, best first (ids only of `ctx.types`): a relation's allowed
 * types (else the collection's or query's), pattern matches first among them; without a context,
 * the pattern matches in the row's order, then the last type. Empty: no suggestion.
 */
export function suggestType(name: string, ctx: SuggestContext): string[] {
  const offered = new Set(ctx.types.map((t) => t.id))
  const patternIds = unique(
    ctx.types.filter((t) => matches(name, (t.namePatterns ?? []) as readonly unknown[])).map((t) => t.id),
  )
  const allowed = ctx.allowed ?? []
  const source = allowed.length > 0 ? allowed : (ctx.scope ?? [])
  const ctxIds = unique(source.filter((i) => offered.has(i)))
  if (ctxIds.length > 0) {
    return [...ctxIds.filter((i) => patternIds.includes(i)), ...ctxIds.filter((i) => !patternIds.includes(i))]
  }
  const last = ctx.last
  return [...patternIds, ...(last && offered.has(last) && !patternIds.includes(last) ? [last] : [])]
}
