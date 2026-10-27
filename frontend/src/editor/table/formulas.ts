/**
 * Table formulas (Object's `SimpleTableBlock` formulas). A cell whose text
 * starts with `=` is a formula; the text stays in the file as written, and the
 * editor shows the value it computes (`FormulaCell.tsx`).
 *
 * The language: numbers, `+ - * / ^` (with `^` binding tightest and right to
 * left), unary `+`/`-`, parentheses, cell references (`A1`: columns lettered,
 * rows counted from 1 at the table's first row, the header row included; our
 * choice), ranges (`A1:B3`, only as function arguments) and Object's 20
 * statements (`blocks.simpleTable.formulas.statements.*`). Function names and
 * references are case-insensitive and arguments are separated by `,` or `;`
 * (our choices). A constant can be written bare (`PI`) or called (`PI()`).
 *
 * Values a reference reads: a formula cell gives its value (its error spreads),
 * a number cell its number, an empty cell 0 (our choice), any other text the
 * "Value" error. A range skips empty and non-number cells (as a spreadsheet's
 * SUM does; our choice), so `COUNT` counts the numbers in it.
 *
 * Errors carry Object's titles ("Circular", "Expression", "Reference",
 * "Value") and messages (`blocks.simpleTable.formulas.errors.*`).
 */

import { formatNumber } from '@/properties/format'

/** `blocks.simpleTable.formulas.statements.*`, verbatim, in Object's order. */
export const FORMULA_STATEMENTS: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'ABS', description: 'Get absolute value' },
  { name: 'AVG', description: 'Calculate average of values' },
  { name: 'CEIL', description: 'Round up to nearest integer' },
  { name: 'COUNT', description: 'Count number of values' },
  { name: 'E', description: "Mathematical constant Euler's number" },
  { name: 'FLOOR', description: 'Round down to nearest integer' },
  { name: 'LN', description: 'Calculate the natural logarithm' },
  { name: 'LOG', description: 'Calculate the natural logarithm' },
  { name: 'MAX', description: 'Find maximum value' },
  { name: 'MEDIAN', description: 'Find median value' },
  { name: 'MIN', description: 'Find minimum value' },
  { name: 'PHI', description: 'Mathematical constant Golden ratio' },
  { name: 'PI', description: 'Mathematical constant Pi' },
  { name: 'PRODUCT', description: 'Calculate product of values' },
  { name: 'RAND', description: 'Generate a random number' },
  { name: 'ROUND', description: 'Round to nearest integer' },
  { name: 'SIGN', description: 'Get sign of value' },
  { name: 'SQRT', description: 'Calculate square root' },
  { name: 'SUM', description: 'Calculate sum of values' },
  { name: 'TAU', description: 'Mathematical constant Tau' },
]

/** The statements that take no arguments. */
export const FORMULA_CONSTANTS = new Set(['E', 'PHI', 'PI', 'RAND', 'TAU'])

/** `blocks.simpleTable.formulas.editor.*` */
export const FORMULA_PLACEHOLDER = 'Formula'
export const FORMULA_NO_OPTIONS = 'No options found'

export type FormulaErrorKind = 'circular' | 'expression' | 'reference' | 'value'

/** `blocks.simpleTable.formulas.errors.title.*` */
export const FORMULA_ERROR_TITLES: Record<FormulaErrorKind, string> = {
  circular: 'Circular',
  expression: 'Expression',
  reference: 'Reference',
  value: 'Value',
}

/** `blocks.simpleTable.formulas.errors.message.*`, plus `invalidExpression` (our string). */
export const FORMULA_ERROR_MESSAGES = {
  circularReference: 'The formula contains a circular reference.',
  expressionIsEmpty: 'The formula expression is empty.',
  invalidCellReference: 'The formula contains a reference to an invalid cell.',
  invalidRangeReference: 'The formula contains invalid range references.',
  valueNotANumber: 'The value returned from the formula is not a number.',
  valueNotFinite: 'The value returned from the formula is not finite.',
  /** Our string: a syntax error, an unknown function or a wrong argument count. */
  invalidExpression: 'The formula expression is invalid.',
} as const

export type FormulaMessage = keyof typeof FORMULA_ERROR_MESSAGES

export type FormulaError = { kind: FormulaErrorKind; title: string; message: string }

export type FormulaResult = { ok: true; value: number } | { ok: false; error: FormulaError }

export type CellAt = { row: number; col: number }

function fail(kind: FormulaErrorKind, message: FormulaMessage): FormulaResult {
  return { ok: false, error: { kind, title: FORMULA_ERROR_TITLES[kind], message: FORMULA_ERROR_MESSAGES[message] } }
}

class FormulaFailure extends Error {
  readonly result: Extract<FormulaResult, { ok: false }>
  constructor(result: Extract<FormulaResult, { ok: false }>) {
    super(result.error.message)
    this.result = result
  }
}

function raise(kind: FormulaErrorKind, message: FormulaMessage): never {
  throw new FormulaFailure(fail(kind, message) as Extract<FormulaResult, { ok: false }>)
}

/** Whether a cell's text is a formula (starts with `=`, leading spaces allowed). */
export function isFormula(text: string): boolean {
  return /^\s*=/.test(text)
}

/** The expression after the `=`, or null when `text` is not a formula. */
export function formulaExpression(text: string): string | null {
  const m = /^\s*=/.exec(text)
  return m ? text.slice(m[0].length) : null
}

/** `0` → `A`, `25` → `Z`, `26` → `AA`. */
export function columnLetter(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/** `A1` → `{ row: 0, col: 0 }`; null when it is not a cell reference. */
export function parseCellRef(ref: string): CellAt | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref)
  if (!m) return null
  let col = 0
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  const row = Number(m[2])
  if (row < 1) return null
  return { row: row - 1, col: col - 1 }
}

/** A cell's text as a number: digits with an optional sign, `.` decimals, `,` groups and exponent; else null. */
export function cellNumber(text: string): number | null {
  const t = text.replace(/[\s​]/g, '').replace(/,/g, '')
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// ------------------------------------------------------------------ tokens

type Token =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i))
    if (num) {
      out.push({ t: 'num', v: Number(num[0]) })
      i += num[0].length
      continue
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))
    if (id) {
      out.push({ t: 'id', v: id[0] })
      i += id[0].length
      continue
    }
    if ('+-*/^(),;:'.includes(ch)) {
      out.push({ t: 'op', v: ch === ';' ? ',' : ch })
      i++
      continue
    }
    raise('expression', 'invalidExpression')
  }
  return out
}

// ------------------------------------------------------------------ evaluation

/** A value inside an expression: a number, or the numbers of a range (function arguments only). */
type Value = number | { range: number[] }

export type FormulaGrid = ReadonlyArray<ReadonlyArray<string>>

type Context = {
  grid: FormulaGrid
  cache: Map<string, FormulaResult>
  visiting: Set<string>
  random: () => number
}

const keyOf = (c: CellAt) => `${c.row}:${c.col}`

function inGrid(grid: FormulaGrid, c: CellAt): boolean {
  return c.row >= 0 && c.row < grid.length && c.col >= 0 && c.col < (grid[c.row]?.length ?? 0)
}

/** The result of the cell at `c` as a formula cell, a number cell, empty or text. */
function cellValue(ctx: Context, c: CellAt): { kind: 'number'; v: number } | { kind: 'empty' } | { kind: 'text' } {
  const text = ctx.grid[c.row][c.col] ?? ''
  if (isFormula(text)) {
    const r = evaluateCell(ctx, c)
    if (!r.ok) throw new FormulaFailure(r)
    return { kind: 'number', v: r.value }
  }
  if (text.trim() === '') return { kind: 'empty' }
  const n = cellNumber(text)
  return n == null ? { kind: 'text' } : { kind: 'number', v: n }
}

function evaluateCell(ctx: Context, c: CellAt): FormulaResult {
  const key = keyOf(c)
  const cached = ctx.cache.get(key)
  if (cached) return cached
  if (ctx.visiting.has(key)) return fail('circular', 'circularReference')
  ctx.visiting.add(key)
  let result: FormulaResult
  try {
    result = evaluateExpression(ctx, formulaExpression(ctx.grid[c.row][c.col]) ?? '')
  } finally {
    ctx.visiting.delete(key)
  }
  // A cycle's error belongs to every cell on it; cache only settled results.
  ctx.cache.set(key, result)
  return result
}

function num(v: Value): number {
  if (typeof v === 'number') return v
  return raise('reference', 'invalidRangeReference')
}

function flatten(args: Value[]): number[] {
  const out: number[] = []
  for (const a of args) {
    if (typeof a === 'number') out.push(a)
    else out.push(...a.range)
  }
  return out
}

function median(xs: number[]): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function roundTo(x: number, digits: number): number {
  const d = Math.trunc(digits)
  const f = 10 ** d
  return Math.round(x * f) / f
}

function callStatement(ctx: Context, name: string, args: Value[]): number {
  const one = (): number => {
    if (args.length !== 1) raise('expression', 'invalidExpression')
    return num(args[0])
  }
  const oneOrTwo = (): [number, number | null] => {
    if (args.length < 1 || args.length > 2) raise('expression', 'invalidExpression')
    return [num(args[0]), args.length === 2 ? num(args[1]) : null]
  }
  const none = (): void => {
    if (args.length) raise('expression', 'invalidExpression')
  }
  switch (name) {
    case 'ABS':
      return Math.abs(one())
    case 'CEIL':
      return Math.ceil(one())
    case 'FLOOR':
      return Math.floor(one())
    case 'LN':
      return Math.log(one())
    case 'LOG': {
      // Object describes LOG as the natural logarithm; a second argument is the base (our choice).
      const [x, base] = oneOrTwo()
      return base == null ? Math.log(x) : Math.log(x) / Math.log(base)
    }
    case 'ROUND': {
      // A second argument is the number of decimals (our choice).
      const [x, digits] = oneOrTwo()
      return roundTo(x, digits ?? 0)
    }
    case 'SIGN':
      return Math.sign(one())
    case 'SQRT':
      return Math.sqrt(one())
    case 'SUM':
      return flatten(args).reduce((a, b) => a + b, 0)
    case 'PRODUCT':
      return flatten(args).reduce((a, b) => a * b, 1)
    case 'AVG': {
      const xs = flatten(args)
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN
    }
    case 'COUNT':
      return flatten(args).length
    case 'MAX': {
      const xs = flatten(args)
      return xs.length ? Math.max(...xs) : NaN
    }
    case 'MIN': {
      const xs = flatten(args)
      return xs.length ? Math.min(...xs) : NaN
    }
    case 'MEDIAN':
      return median(flatten(args))
    case 'E':
      none()
      return Math.E
    case 'PI':
      none()
      return Math.PI
    case 'TAU':
      none()
      return 2 * Math.PI
    case 'PHI':
      none()
      return (1 + Math.sqrt(5)) / 2
    case 'RAND':
      none()
      return ctx.random()
    default:
      return raise('expression', 'invalidExpression')
  }
}

const STATEMENT_NAMES = new Set(FORMULA_STATEMENTS.map((s) => s.name))

/** Recursive descent over the tokens; each level returns the value it read. */
function parse(ctx: Context, tokens: Token[]): Value {
  let i = 0
  const peek = () => tokens[i]
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v
  const expect = (v: string) => {
    if (!isOp(v)) raise('expression', 'invalidExpression')
    i++
  }

  const reference = (ref: string): CellAt => {
    const c = parseCellRef(ref)
    if (!c) raise('expression', 'invalidExpression')
    return c
  }

  const range = (from: CellAt, to: CellAt): Value => {
    if (!inGrid(ctx.grid, from) || !inGrid(ctx.grid, to)) raise('reference', 'invalidRangeReference')
    const out: number[] = []
    for (let r = Math.min(from.row, to.row); r <= Math.max(from.row, to.row); r++) {
      for (let c = Math.min(from.col, to.col); c <= Math.max(from.col, to.col); c++) {
        if (!inGrid(ctx.grid, { row: r, col: c })) continue
        const v = cellValue(ctx, { row: r, col: c })
        if (v.kind === 'number') out.push(v.v)
      }
    }
    return { range: out }
  }

  const primary = (): Value => {
    const tok = peek()
    if (!tok) raise('expression', 'invalidExpression')
    if (tok.t === 'num') {
      i++
      return tok.v
    }
    if (tok.t === 'op' && tok.v === '(') {
      i++
      const v = additive()
      expect(')')
      return v
    }
    if (tok.t === 'id') {
      i++
      const upper = tok.v.toUpperCase()
      if (isOp('(')) {
        i++
        if (!STATEMENT_NAMES.has(upper)) raise('expression', 'invalidExpression')
        const args: Value[] = []
        if (!isOp(')')) {
          args.push(additive())
          while (isOp(',')) {
            i++
            args.push(additive())
          }
        }
        expect(')')
        return callStatement(ctx, upper, args)
      }
      if (FORMULA_CONSTANTS.has(upper)) return callStatement(ctx, upper, [])
      const from = reference(tok.v)
      if (isOp(':')) {
        i++
        const next = peek()
        if (next?.t !== 'id' || !parseCellRef(next.v)) raise('reference', 'invalidRangeReference')
        i++
        return range(from, parseCellRef(next.v)!)
      }
      if (!inGrid(ctx.grid, from)) raise('reference', 'invalidCellReference')
      const v = cellValue(ctx, from)
      if (v.kind === 'text') raise('value', 'valueNotANumber')
      return v.kind === 'number' ? v.v : 0
    }
    return raise('expression', 'invalidExpression')
  }

  // `^` binds tighter than unary minus (`-2^2` is -4) and groups right to left.
  const power = (): Value => {
    const base = primary()
    if (isOp('^')) {
      i++
      const exp = unary()
      return num(base) ** num(exp)
    }
    return base
  }

  const unary = (): Value => {
    if (isOp('-')) {
      i++
      return -num(unary())
    }
    if (isOp('+')) {
      i++
      return num(unary())
    }
    return power()
  }

  const multiplicative = (): Value => {
    let left = unary()
    while (isOp('*') || isOp('/')) {
      const op = peek()!.v
      i++
      const right = unary()
      left = op === '*' ? num(left) * num(right) : num(left) / num(right)
    }
    return left
  }

  const additive = (): Value => {
    let left = multiplicative()
    while (isOp('+') || isOp('-')) {
      const op = peek()!.v
      i++
      const right = multiplicative()
      left = op === '+' ? num(left) + num(right) : num(left) - num(right)
    }
    return left
  }

  const value = additive()
  if (i < tokens.length) raise('expression', 'invalidExpression')
  return value
}

function evaluateExpression(ctx: Context, expr: string): FormulaResult {
  if (expr.trim() === '') return fail('expression', 'expressionIsEmpty')
  try {
    const v = num(parse(ctx, tokenize(expr)))
    if (Number.isNaN(v)) return fail('value', 'valueNotANumber')
    if (!Number.isFinite(v)) return fail('value', 'valueNotFinite')
    return { ok: true, value: v }
  } catch (e) {
    if (e instanceof FormulaFailure) return e.result
    throw e
  }
}

export type EvaluateOptions = { random?: () => number }

/**
 * Evaluate the formula `text` (with or without its `=`) against `grid` (each
 * row's cell texts). `at` is the cell holding it, so a reference back to it is
 * "Circular".
 */
export function evaluateFormula(text: string, grid: FormulaGrid, at?: CellAt, opts: EvaluateOptions = {}): FormulaResult {
  const ctx: Context = { grid, cache: new Map(), visiting: new Set(), random: opts.random ?? Math.random }
  if (at && inGrid(grid, at) && grid[at.row][at.col] === text) return evaluateCell(ctx, at)
  if (at) ctx.visiting.add(keyOf(at))
  return evaluateExpression(ctx, formulaExpression(text) ?? text)
}

/** Every cell's formula result (null for a cell that is not a formula), sharing one cache. */
export function evaluateGrid(grid: FormulaGrid, opts: EvaluateOptions = {}): (FormulaResult | null)[][] {
  const ctx: Context = { grid, cache: new Map(), visiting: new Set(), random: opts.random ?? Math.random }
  return grid.map((row, r) => row.map((text, c) => (isFormula(text) ? evaluateCell(ctx, { row: r, col: c }) : null)))
}

/**
 * A formula's value as the cell shows it: rounded to 12 significant digits
 * (so `0.1+0.2` shows `0.3`) and formatted with `formatNumber` (the decimal
 * separator setting, once Settings provides it).
 */
export function formatFormulaValue(value: number): string {
  return formatNumber(Number(value.toPrecision(12)))
}

/** What a cell shows: a formula's value or error title, any other text as written. */
export function shownText(text: string, result: FormulaResult | null | undefined): string {
  if (!isFormula(text) || !result) return text
  return result.ok ? formatFormulaValue(result.value) : result.error.title
}
