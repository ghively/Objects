// M12: a small tokenizer for the formula editor's highlighting. It never fails: every character
// of the input lands in exactly one token, so joining the tokens' text gives the input back.
// The server's parser is the authority on what is valid; this only colours.
import { FORMULA_FUNCTION_NAMES } from './formulaFunctions'

export type FormulaTokenKind =
  | 'function' // a known function name, or any name called with `(`
  | 'prop' // the `prop` in `prop("…")`
  | 'string'
  | 'number'
  | 'keyword' // true, false, and, or, not
  | 'operator'
  | 'punctuation' // ( ) , .
  | 'space'
  | 'other'

export interface FormulaToken {
  kind: FormulaTokenKind
  text: string
}

const KEYWORDS = new Set(['true', 'false', 'and', 'or', 'not'])
const OPERATORS = ['||', '&&', '==', '!=', '<=', '>=', '<', '>', '+', '-', '*', '/', '%', '!']

export function tokenizeFormula(src: string): FormulaToken[] {
  const out: FormulaToken[] = []
  const push = (kind: FormulaTokenKind, text: string) => {
    const last = out[out.length - 1]
    if (last && last.kind === kind && (kind === 'other' || kind === 'space')) last.text += text
    else out.push({ kind, text })
  }
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      let j = i + 1
      while (j < src.length && /\s/.test(src[j])) j++
      push('space', src.slice(i, j))
      i = j
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1
      j = Math.min(src.length, j + 1)
      push('string', src.slice(i, j))
      i = j
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?|^[0-9]+\.?/.exec(src.slice(i))
      const text = m ? m[0] : c
      push('number', text)
      i += text.length
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      const text = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))![0]
      let k = i + text.length
      while (k < src.length && /\s/.test(src[k])) k++
      const called = src[k] === '('
      const kind: FormulaTokenKind =
        text === 'prop' && called
          ? 'prop'
          : KEYWORDS.has(text)
            ? 'keyword'
            : called || FORMULA_FUNCTION_NAMES.has(text)
              ? 'function'
              : 'other'
      push(kind, text)
      i += text.length
      continue
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i))
    if (op) {
      push('operator', op)
      i += op.length
      continue
    }
    push('(),.'.includes(c) ? 'punctuation' : 'other', c)
    i++
  }
  return out
}
