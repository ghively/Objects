/**
 * Split a Markdown body into top-level source blocks, keeping each block's
 * exact original text so it can be re-emitted verbatim when unedited.
 *
 * Invariant: `joinBlocks(splitBlocks(body)) === body` for every input,
 * including CRLF / lone-CR line endings, a BOM and a missing final newline.
 */
import { marked } from 'marked'

export type SourceBlock = { kind: string; raw: string }

/**
 * `marked` normalises `\r\n` and `\r` to `\n` before lexing, so token `.raw`
 * values are offsets into the normalised text. We lex the normalised text and
 * map each token's span back onto the original string.
 */
export function splitBlocks(body: string): SourceBlock[] {
  if (body === '') return []

  const hasCR = body.includes('\r')
  const normalized = hasCR ? body.replace(/\r\n?/g, '\n') : body
  // origAt[i] = index in `body` of normalised char i (origAt[len] = body.length).
  const origAt = hasCR ? buildOffsetMap(body, normalized.length) : null
  const toOrig = (i: number) => (origAt ? origAt[i] : i)

  const blocks: SourceBlock[] = []
  let pos = 0
  let tokens: { type: string; raw: string }[]
  try {
    tokens = marked.lexer(normalized, { gfm: true })
  } catch {
    tokens = []
  }

  for (const token of tokens) {
    if (!token.raw) continue
    if (!normalized.startsWith(token.raw, pos)) break // misaligned: keep the rest as one block
    const end = pos + token.raw.length
    blocks.push({ kind: token.type, raw: body.slice(toOrig(pos), toOrig(end)) })
    pos = end
  }

  if (pos < normalized.length) {
    blocks.push({ kind: 'raw', raw: body.slice(toOrig(pos)) })
  }
  return blocks
}

export function joinBlocks(bs: SourceBlock[]): string {
  return bs.map((b) => b.raw).join('')
}

function buildOffsetMap(body: string, normalizedLength: number): Uint32Array {
  const map = new Uint32Array(normalizedLength + 1)
  let n = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body.charCodeAt(i)
    if (ch === 13 /* \r */ && body.charCodeAt(i + 1) === 10 /* \n */) continue // the \n stands for both
    map[n++] = ch === 10 && i > 0 && body.charCodeAt(i - 1) === 13 ? i - 1 : i
  }
  map[n] = body.length
  return map
}
