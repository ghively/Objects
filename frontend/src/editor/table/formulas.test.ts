import { describe, expect, test } from 'vitest'
import {
  FORMULA_ERROR_MESSAGES,
  FORMULA_ERROR_TITLES,
  FORMULA_NO_OPTIONS,
  FORMULA_PLACEHOLDER,
  FORMULA_STATEMENTS,
  cellNumber,
  columnLetter,
  evaluateFormula,
  evaluateGrid,
  formatFormulaValue,
  isFormula,
  parseCellRef,
  shownText,
  type FormulaResult,
} from './formulas'

const value = (r: FormulaResult) => (r.ok ? r.value : r.error.title)

// Rows counted from the header row: A1 = "Item", B2 = 10, B3 = 20, B4 = 30.
const GRID = [
  ['Item', 'Qty', 'Price'],
  ['apples', '10', '1.5'],
  ['pears', '20', '2'],
  ['plums', '30', ''],
]

function calc(expr: string, grid = GRID): number | string {
  return value(evaluateFormula(expr, grid))
}

describe('formulas', () => {
  test('test formula statements list matches reference', () => {
    // blocks.simpleTable.formulas.statements.*, verbatim.
    expect(FORMULA_STATEMENTS).toEqual([
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
    ])
    expect(FORMULA_ERROR_TITLES).toEqual({
      circular: 'Circular',
      expression: 'Expression',
      reference: 'Reference',
      value: 'Value',
    })
    expect(FORMULA_ERROR_MESSAGES).toMatchObject({
      circularReference: 'The formula contains a circular reference.',
      expressionIsEmpty: 'The formula expression is empty.',
      invalidCellReference: 'The formula contains a reference to an invalid cell.',
      invalidRangeReference: 'The formula contains invalid range references.',
      valueNotANumber: 'The value returned from the formula is not a number.',
      valueNotFinite: 'The value returned from the formula is not finite.',
    })
    expect(FORMULA_PLACEHOLDER).toBe('Formula')
    expect(FORMULA_NO_OPTIONS).toBe('No options found')
  })

  test('test arithmetic and ranges', () => {
    expect(calc('=1+2*3')).toBe(7)
    expect(calc('=(1+2)*3')).toBe(9)
    expect(calc('=2^3^2')).toBe(512)
    expect(calc('=-2^2')).toBe(-4)
    expect(calc('=10/4-1')).toBe(1.5)
    expect(calc('= 1.5e2 + .5')).toBe(150.5)
    expect(calc('=B2+B3')).toBe(30)
    expect(calc('=b2*c2')).toBe(15)
    expect(calc('=C4+1')).toBe(1) // an empty cell reads 0
    expect(calc('=SUM(B2:B4)')).toBe(60)
    expect(calc('=SUM(B2:C4)')).toBe(63.5)
    expect(calc('=AVG(B2:B4)')).toBe(20)
    expect(calc('=COUNT(A1:C4)')).toBe(5) // numbers only
    expect(calc('=MIN(B2:B4; 5)')).toBe(5)
    expect(calc('=MAX(B2:B4, C2:C3)')).toBe(30)
    expect(calc('=MEDIAN(B2:B4, 100)')).toBe(25)
    expect(calc('=PRODUCT(B2:B3)')).toBe(200)
    expect(calc('=ABS(-3)+CEIL(1.2)+FLOOR(1.8)+SIGN(-9)')).toBe(5)
    expect(calc('=ROUND(2.5)')).toBe(3)
    expect(calc('=ROUND(PI, 2)')).toBe(3.14)
    expect(calc('=SQRT(16)')).toBe(4)
    expect(calc('=LN(E)')).toBe(1)
    expect(calc('=LOG(E())')).toBe(1)
    expect(calc('=LOG(100, 10)')).toBeCloseTo(2)
    expect(calc('=TAU/PI')).toBe(2)
    expect(calc('=PHI')).toBeCloseTo(1.6180339887)
    expect(value(evaluateFormula('=RAND()', GRID, undefined, { random: () => 0.25 }))).toBe(0.25)
    // A formula reads another formula's value.
    const grid = [
      ['a', 'b'],
      ['1', '=A2*2'],
      ['=B2+1', '=SUM(A2:B2)+A3'],
    ]
    const results = evaluateGrid(grid)
    expect(results[1][1] && value(results[1][1])).toBe(2)
    expect(results[2][0] && value(results[2][0])).toBe(3)
    expect(results[2][1] && value(results[2][1])).toBe(6)
    expect(results[0][0]).toBeNull()
    // Shown values.
    expect(formatFormulaValue(0.1 + 0.2)).toBe('0.3')
    expect(shownText('=1/4', evaluateFormula('=1/4', GRID))).toBe('0.25')
    expect(shownText('plain', null)).toBe('plain')
    // Helpers.
    expect(columnLetter(0)).toBe('A')
    expect(columnLetter(26)).toBe('AA')
    expect(parseCellRef('AA10')).toEqual({ row: 9, col: 26 })
    expect(parseCellRef('A0')).toBeNull()
    expect(cellNumber('1,234.5')).toBe(1234.5)
    expect(cellNumber('12 apples')).toBeNull()
  })

  test('test circular reference error', () => {
    const grid = [
      ['=A1+1', '=C1', '=B1'],
      ['=A2', '1', '=B2'],
    ]
    const results = evaluateGrid(grid)
    for (const r of [results[0][0], results[0][1], results[0][2], results[1][0]]) {
      expect(r).toEqual({
        ok: false,
        error: { kind: 'circular', title: 'Circular', message: 'The formula contains a circular reference.' },
      })
    }
    expect(results[1][2] && value(results[1][2])).toBe(1)
    // A formula in a cell that reads itself through a range is circular too.
    expect(value(evaluateFormula('=SUM(A1:B1)', [['=SUM(A1:B1)', '2']], { row: 0, col: 0 }))).toBe('Circular')
  })

  test('test invalid reference and value errors', () => {
    const err = (expr: string) => {
      const r = evaluateFormula(expr, GRID)
      return r.ok ? null : [r.error.title, r.error.message]
    }
    expect(err('=Z9')).toEqual(['Reference', 'The formula contains a reference to an invalid cell.'])
    expect(err('=SUM(A1:Z9)')).toEqual(['Reference', 'The formula contains invalid range references.'])
    expect(err('=SUM(A1:)')).toEqual(['Reference', 'The formula contains invalid range references.'])
    expect(err('=B2:B3+1')).toEqual(['Reference', 'The formula contains invalid range references.'])
    expect(err('=A2+1')).toEqual(['Value', 'The value returned from the formula is not a number.'])
    expect(err('=SQRT(-1)')).toEqual(['Value', 'The value returned from the formula is not a number.'])
    expect(err('=1/0')).toEqual(['Value', 'The value returned from the formula is not finite.'])
    expect(err('=AVG(C4:C4)')).toEqual(['Value', 'The value returned from the formula is not a number.'])
    expect(err('=')).toEqual(['Expression', 'The formula expression is empty.'])
    expect(err('=   ')).toEqual(['Expression', 'The formula expression is empty.'])
    expect(err('=1+')).toEqual(['Expression', 'The formula expression is invalid.'])
    expect(err('=FOO(1)')).toEqual(['Expression', 'The formula expression is invalid.'])
    expect(err('=ABS(1, 2)')).toEqual(['Expression', 'The formula expression is invalid.'])
    expect(err('=(1')).toEqual(['Expression', 'The formula expression is invalid.'])
    expect(err('=1 $ 2')).toEqual(['Expression', 'The formula expression is invalid.'])
    // An error spreads to the formulas that read it.
    const results = evaluateGrid([['=1/0', '=A1+1']])
    expect(results[0][1] && value(results[0][1])).toBe('Value')
  })

  test('absolute references, whole-column ranges and the one-= rule (Object reference)', () => {
    // $ marks read as the plain reference.
    expect(calc('=$B$2+B$3+$B4')).toBe(60)
    expect(calc('=SUM($B$2:$B$4)')).toBe(60)
    expect(parseCellRef('$C$12')).toEqual({ row: 11, col: 2 })
    // A whole column is rows 1 to the last; text and empty cells are skipped as in any range.
    expect(calc('=SUM(B:B)')).toBe(60)
    expect(calc('=SUM(B:C)')).toBe(63.5)
    expect(calc('=COUNT($B:$B)')).toBe(3)
    expect(calc('=SUM(B3:B)')).toBe(50)
    expect(calc('=SUM(B:B2)')).toBe(10)
    // E is a column here, not the constant.
    expect(calc('=SUM(E:E)')).toBe('Reference')
    expect(calc('=E')).toBeCloseTo(Math.E)
    // A formula has exactly one `=`.
    expect(isFormula('=B2')).toBe(true)
    expect(isFormula('=')).toBe(true)
    expect(isFormula('=B2=B3')).toBe(false)
    expect(isFormula('==B2')).toBe(false)
    expect(shownText('=B2=B3', null)).toBe('=B2=B3')
    expect(evaluateGrid([['=1=1', '=1+1']])[0]).toEqual([null, { ok: true, value: 2 }])
  })
})
