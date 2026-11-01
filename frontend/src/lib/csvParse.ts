/**
 * RFC 4180 CSV parsing, the inverse of `editor/table/csv.ts` `toCsv`: fields separated by
 * commas, records by CRLF or LF (or a lone CR), a field in double quotes may hold commas, line
 * breaks and doubled quotes. A leading BOM is dropped. A file that ends inside a quoted field, has
 * a quote in the middle of an unquoted field, or text after a closing quote, is read as well as
 * possible and flagged (`error`), for Import CSV's "Some issues were found while parsing your file." note.
 */
export interface CsvParseResult {
  rows: string[][]
  error: boolean
}

/** A field with whether it was quoted: a quoted cell is one value to Import CSV, however many commas it holds. */
export interface CsvCell {
  text: string
  quoted: boolean
}

export interface CsvCellsResult {
  rows: CsvCell[][]
  error: boolean
}

export function parseCsv(text: string): CsvParseResult {
  const { rows, error } = parseCsvCells(text)
  return { rows: rows.map((r) => r.map((c) => c.text)), error }
}

export function parseCsvCells(text: string): CsvCellsResult {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: CsvCell[][] = []
  let row: CsvCell[] = []
  let field = ''
  let quoted = false
  // The current field opened with a quote (and has closed it): what follows must be a separator.
  let wasQuoted = false
  let error = false
  let i = 0
  const endField = () => {
    row.push({ text: field, quoted: wasQuoted })
    field = ''
    wasQuoted = false
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }
  while (i < src.length) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      field += c
      i += 1
      continue
    }
    if (c === '"') {
      if (field === '' && !wasQuoted) {
        quoted = true
        wasQuoted = true
      } else {
        error = true
        field += c
      }
      i += 1
    } else if (c === ',') {
      endField()
      i += 1
    } else if (c === '\r' || c === '\n') {
      endRow()
      i += c === '\r' && src[i + 1] === '\n' ? 2 : 1
    } else {
      // Text after a closing quote is kept, but the file is not well-formed.
      if (wasQuoted) error = true
      field += c
      i += 1
    }
  }
  if (quoted) error = true
  // A last record without a line break; a trailing line break adds no empty record.
  if (field !== '' || row.length > 0 || wasQuoted) endRow()
  return { rows, error }
}
