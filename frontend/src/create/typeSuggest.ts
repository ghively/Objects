/**
 * M29: the suggested type of a create row, ported 1:1 from `backend/objectapp/typesuggest.py`
 * (both run the parity fixture `__fixtures__/suggest-cases.json`). Context and name patterns only:
 * no AI, no network, nothing sent anywhere; it runs per keystroke.
 *
 * Pattern syntax (the whole name must match, case-insensitive, after trimming): a pattern that is
 * exactly one token `{ip}`, `{cidr}`, `{fqdn}` or `{version}`, or else a glob where `*` is any run of
 * non-space characters (or none), `?` one non-space character, `#` one digit, `@` one letter a-z and
 * `\` makes the next character literal. A glob is matched by a state-set simulation over its tokens
 * (never a backtracking regex), so matching is linear in the name's length whatever the pattern.
 */
import type { TypeDef } from '@/api/types'

export const MAX_PATTERNS = 20
export const MAX_PATTERN = 100
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

/** A compiled name pattern: `test(name)` is whether the whole (trimmed) name matches. */
export interface CompiledPattern {
  test(name: string): boolean
}

// --- the four whole tokens -------------------------------------------------------------------

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
const IPV6_CHARS = /^[0-9a-f:]+$/i
const V4_PREFIX = /^(3[0-2]|[12]?\d)$/
const V6_PREFIX = /^(12[0-8]|1[01]\d|[1-9]?\d)$/
const FQDN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}[a-z]{2,63}$/i
const VERSION_TAIL = /^v?\d+(\.\d+)*[a-z]?$/i
const LINE_BREAK = /[\n\r\u2028\u2029]/

/** `^(?=.*:.*:)[0-9a-f:]+$`, without the lookahead's backtracking. */
function isIpv6(s: string): boolean {
  if (!IPV6_CHARS.test(s)) return false
  const first = s.indexOf(':')
  return first >= 0 && s.indexOf(':', first + 1) >= 0
}

function isIp(s: string): boolean {
  return IPV4.test(s) || isIpv6(s)
}

function isCidr(s: string): boolean {
  const slash = s.lastIndexOf('/')
  if (slash < 0) return false
  const addr = s.slice(0, slash)
  const prefix = s.slice(slash + 1)
  if (IPV4.test(addr)) return V4_PREFIX.test(prefix)
  if (isIpv6(addr)) return V6_PREFIX.test(prefix)
  return false
}

/**
 * `^\S.*\s+v?\d+(\.\d+)*[a-z]?$`, in linear time: the version is what follows the last whitespace
 * run, and what comes before that run (after the first character) holds no line break.
 */
function isVersion(s: string): boolean {
  let end = s.length - 1
  while (end >= 0 && !/\s/.test(s[end])) end--
  if (end < 1) return false
  if (!VERSION_TAIL.test(s.slice(end + 1))) return false
  let start = end
  while (start > 0 && /\s/.test(s[start - 1])) start--
  if (start < 1 || /\s/.test(s[0])) return false
  return !LINE_BREAK.test(s.slice(1, start))
}

const TOKEN_TESTS: Record<(typeof TOKENS)[number], (s: string) => boolean> = {
  '{ip}': isIp,
  '{cidr}': isCidr,
  '{fqdn}': (s) => FQDN.test(s),
  '{version}': isVersion,
}

// --- globs -----------------------------------------------------------------------------------

type GlobToken =
  | { kind: 'star' }
  | { kind: 'one' }
  | { kind: 'digit' }
  | { kind: 'letter' }
  | { kind: 'literal'; lower: string; upper: string }

const SPACE = /\s/
const LETTER = /^[a-z]$/i
const DIGIT = /^[0-9]$/

function stepMatches(t: GlobToken, c: string): boolean {
  switch (t.kind) {
    case 'one':
      return !SPACE.test(c)
    case 'digit':
      return DIGIT.test(c)
    case 'letter':
      return LETTER.test(c)
    case 'literal':
      return c.toLowerCase() === t.lower || c.toUpperCase() === t.upper
    default:
      return false
  }
}

/** Parse a glob into tokens; null when it is invalid (a brace anywhere, a trailing `\`). */
function parseGlob(chars: string[]): GlobToken[] | null {
  const tokens: GlobToken[] = []
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (c === '{' || c === '}') return null
    if (c === '\\') {
      i++
      if (i >= chars.length) return null
      const next = chars[i]
      if (next === '{' || next === '}') return null
      tokens.push({ kind: 'literal', lower: next.toLowerCase(), upper: next.toUpperCase() })
    } else if (c === '*') tokens.push({ kind: 'star' })
    else if (c === '?') tokens.push({ kind: 'one' })
    else if (c === '#') tokens.push({ kind: 'digit' })
    else if (c === '@') tokens.push({ kind: 'letter' })
    else tokens.push({ kind: 'literal', lower: c.toLowerCase(), upper: c.toUpperCase() })
  }
  return tokens
}

/**
 * Whether `name` (already trimmed) matches the glob: a set of pattern positions advanced one
 * character at a time; a `*` position loops on any non-space character and also lets the next
 * position start. O(name length × pattern length), never exponential.
 */
function globMatch(tokens: GlobToken[], name: string): boolean {
  const m = tokens.length
  let active = new Uint8Array(m + 1)
  const close = (set: Uint8Array) => {
    for (let p = 0; p < m; p++) if (set[p] && tokens[p].kind === 'star') set[p + 1] = 1
  }
  active[0] = 1
  close(active)
  for (const c of name) {
    const next = new Uint8Array(m + 1)
    let any = false
    for (let p = 0; p < m; p++) {
      if (!active[p]) continue
      const t = tokens[p]
      if (t.kind === 'star') {
        if (!SPACE.test(c)) {
          next[p] = 1
          any = true
        }
      } else if (stepMatches(t, c)) {
        next[p + 1] = 1
        any = true
      }
    }
    if (!any) return false
    close(next)
    active = next
  }
  return active[m] === 1
}

// --- compile, match, suggest -----------------------------------------------------------------

const MEMO_LIMIT = 512
const memo = new Map<string, CompiledPattern | null>()

function compileUncached(pattern: string): CompiledPattern | null {
  if ((TOKENS as readonly string[]).includes(pattern)) {
    const test = TOKEN_TESTS[pattern as (typeof TOKENS)[number]]
    return { test: (name) => test(name.trim()) }
  }
  const chars = Array.from(pattern)
  if (chars.length === 0 || chars.length > MAX_PATTERN) return null
  const tokens = parseGlob(chars)
  if (!tokens) return null
  return { test: (name) => globMatch(tokens, name.trim()) }
}

/** The matcher of one name pattern, or null when the pattern is invalid. Memoised (512 kept). */
export function compilePattern(pattern: string): CompiledPattern | null {
  if (typeof pattern !== 'string') return null
  const hit = memo.get(pattern)
  if (hit !== undefined) return hit
  const compiled = compileUncached(pattern)
  if (memo.size >= MEMO_LIMIT) {
    const oldest = memo.keys().next().value
    if (oldest !== undefined) memo.delete(oldest)
  }
  memo.set(pattern, compiled)
  return compiled
}

/** Whether `name` matches any valid pattern; invalid and non-string entries are ignored. */
export function matches(name: string, patterns: readonly unknown[]): boolean {
  if (!Array.isArray(patterns)) return false
  for (const p of patterns) {
    if (typeof p !== 'string') continue
    const compiled = compilePattern(p)
    if (compiled && compiled.test(name)) return true
  }
  return false
}

/**
 * The suggested type ids for `name`, best first (ids only of `ctx.types`): a relation's allowed
 * types (else the collection's or query's), pattern matches first among them; without a context,
 * the pattern matches in the row's order, then the last type. Empty: no suggestion.
 */
export function suggestType(name: string, ctx: SuggestContext): string[] {
  const offered = new Set(ctx.types.map((t) => t.id))
  const patternIds = ctx.types
    .filter((t) => matches(name, (t.namePatterns ?? []) as readonly unknown[]))
    .map((t) => t.id)
  const allowed = ctx.allowed ?? []
  const source = allowed.length > 0 ? allowed : (ctx.scope ?? [])
  const ctxIds = source.filter((i) => offered.has(i))
  if (ctxIds.length > 0) {
    return [...ctxIds.filter((i) => patternIds.includes(i)), ...ctxIds.filter((i) => !patternIds.includes(i))]
  }
  const last = ctx.last
  return [...patternIds, ...(last && offered.has(last) && !patternIds.includes(last) ? [last] : [])]
}
