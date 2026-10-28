/**
 * "Import CSV" on a type page (`database.options.options.importCsv.text`): Object's
 * "Batch import to collection" modal. Every data row of the file becomes one object of the
 * type; each column maps to a property ("Property Mappings", the first column to the title by
 * default, the others to a property of the same name). The objects go into the type, or into a
 * new collection named after the file. Nothing but the new objects (and that collection) is written.
 */
import { useMemo, useState } from 'react'
import { api } from '@/api/client'
import type { PropertyDef, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { parseCsv } from '@/lib/csvParse'
import { CHANGE_TYPE_TEXT } from '@/object/ChangeTypeDialog'
import { parseDateInput } from '@/properties/DatePicker'
import { parseNumberInput } from '@/properties/format'

export const IMPORT_CSV_TEXT = {
  /** `database.options.options.importCsv.text` */
  menu: 'Import CSV',
  /** `CSVImportModal.heading` */
  heading: 'Batch import to collection',
  /** `CSVImportModal.description` */
  description: 'You can upload a CSV that will be transformed into a collection. Every row will create one entity.',
  /** `PageImportSection.chooseOrDrop` */
  chooseFile: 'Choose file or drop here.',
  /** `CSVImportModal.headerRow.title` */
  headerRow: 'Has a header row',
  /** `CSVImportModal.headerRow.description` */
  headerRowDescription: 'First row in CSV holds column names and is not itself a data row.',
  /** `CSVImportModal.warning.heading` */
  warningHeading: 'Use this with caution',
  /** `CSVImportModal.warning.text` */
  warningText: 'Every row in your table will be transformed into a new object. You can quickly spam your whole space if you import big tables.',
  /** `CSVImportModal.errors.readingError` */
  readingError: 'Some issues were found while parsing your file. Make sure to use a valid CSV file to ensure the import you expect.',
  /** `CSVImportModal.notSupported` */
  notSupported: (rowLimit: number) => `This file is not supported. We only support CSV imports up to ${rowLimit} rows.`,
  /** `CSVImportModal.newCollection` */
  newCollection: (title: string) => `New collection "${title}"`,
  /** `PropertyTransformation.info`, before the target. */
  info: (count: number, plural: string) => `Add ${count} new ${plural} to`,
  /** `PropertyTransformation.propertyMapping.heading` */
  mappings: 'Property Mappings',
  /** `PropertyTransformation.propertyMapping.description.text` */
  mappingsDescription: 'Multiple values can be mapped to the same property, but only the first transferred value is kept.',
  /** `general.import` */
  import: 'Import',
  /** `general.importing` */
  importing: 'Importing...',
  /** `general.cancel` */
  cancel: 'Cancel',
  /** Our string: a column without a header. */
  column: (n: number) => `Column ${n}`,
}

/** The most data rows one import takes (Object's `rowLimit` value wasn't found: our choice). */
export const CSV_ROW_LIMIT = 1000

/** The title target's key in a mapping. */
export const TITLE_TARGET = 'title'

/** Kinds a CSV value can be imported into (system kinds kept by the app are not). */
const IMPORTABLE = new Set<PropertyDef['type']>([
  'text',
  'textBlock',
  'blocks',
  'url',
  'number',
  'boolean',
  'datetime',
  'datetimeSimple',
  'label',
  'entity',
  'entity_description',
  'entity_tags',
  'entity_aliases',
])

export interface CsvTarget {
  key: string
  name: string
  def?: PropertyDef
}

/** What a column can map to: the title, then the type's importable properties. */
export function csvTargets(type: TypeDef): CsvTarget[] {
  return [
    { key: TITLE_TARGET, name: 'Title' },
    ...type.propertyDefinitions.filter((d) => IMPORTABLE.has(d.type)).map((d) => ({ key: d.key, name: d.name, def: d })),
  ]
}

/** The first column maps to the title; the others to the target of the same name (case-insensitive), else nothing. */
export function defaultMapping(columns: string[], targets: CsvTarget[]): (string | null)[] {
  return columns.map((name, i) => {
    if (i === 0) return TITLE_TARGET
    const n = name.trim().toLowerCase()
    return targets.find((t) => t.key !== TITLE_TARGET && (t.name.toLowerCase() === n || t.key.toLowerCase() === n))?.key ?? null
  })
}

const TRUE_TEXTS = new Set(['true', 'yes', '1'])
const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

/** A cell's text as the API value of `def`, read the way that kind's cell reads typed text; undefined to skip it. */
export function csvValue(def: PropertyDef, text: string): unknown {
  const t = text.trim()
  if (!t) return undefined
  switch (def.type) {
    case 'number': {
      const n = parseNumberInput(t)
      return typeof n === 'number' ? n : undefined
    }
    case 'boolean':
      return TRUE_TEXTS.has(t.toLowerCase())
    case 'datetime':
    case 'datetimeSimple':
      return parseDateInput(t) ?? undefined
    case 'label': {
      // Only the property's own options (case-insensitive); a single-select takes the first.
      const set = (def.options as { set?: { text: string }[] }).set ?? []
      const found = splitList(t)
        .map((x) => set.find((o) => o.text.toLowerCase() === x.toLowerCase())?.text)
        .filter((x): x is string => !!x)
      const many = (def.options as { isArray?: boolean }).isArray !== false
      const out = many ? [...new Set(found)] : found.slice(0, 1)
      return out.length > 0 ? out : undefined
    }
    case 'entity': {
      const many = (def.options as { isArray?: boolean }).isArray !== false
      const targets = many ? splitList(t) : [t]
      return targets.map((target) => ({ target, path: null }))
    }
    case 'entity_tags':
    case 'entity_aliases':
      return [...new Set(splitList(t))]
    default:
      return text
  }
}

/** One record as `{title, values}`; when several columns map to one target, the first non-empty value wins. */
export function csvRecord(record: string[], mapping: (string | null)[], targets: CsvTarget[]): { title: string; values: Record<string, unknown> } {
  let title: string | undefined
  const values: Record<string, unknown> = {}
  mapping.forEach((key, i) => {
    if (!key) return
    const text = record[i] ?? ''
    if (key === TITLE_TARGET) {
      if (title === undefined && text.trim()) title = text.trim()
      return
    }
    if (key in values) return
    const def = targets.find((t) => t.key === key)?.def
    if (!def) return
    const v = csvValue(def, text)
    if (v !== undefined) values[key] = v
  })
  return { title: title ?? '', values }
}

interface Parsed {
  name: string
  rows: string[][]
  error: boolean
}

export function ImportCsvDialog({ type, open, onOpenChange }: { type: TypeDef; open: boolean; onOpenChange(open: boolean): void }) {
  const [file, setFile] = useState<Parsed | null>(null)
  const [header, setHeader] = useState(true)
  const [mapping, setMapping] = useState<(string | null)[]>([])
  const [into, setInto] = useState<'type' | 'newCollection'>('type')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const targets = useMemo(() => csvTargets(type), [type])

  const width = file ? Math.max(0, ...file.rows.map((r) => r.length)) : 0
  const columns = useMemo(() => {
    if (!file) return []
    const head = header ? file.rows[0] ?? [] : []
    return Array.from({ length: width }, (_, i) => head[i]?.trim() || IMPORT_CSV_TEXT.column(i + 1))
  }, [file, header, width])
  const data = file ? (header ? file.rows.slice(1) : file.rows) : []
  const tooMany = data.length > CSV_ROW_LIMIT
  const collectionName = file ? file.name.replace(/\.csv$/i, '') || 'Import' : ''

  const reset = () => {
    setFile(null)
    setHeader(true)
    setMapping([])
    setInto('type')
    setProgress(null)
    setError(null)
  }

  const read = async (f: File | undefined) => {
    if (!f) return
    setError(null)
    const parsed = parseCsv(await f.text())
    const next = { name: f.name, rows: parsed.rows, error: parsed.error }
    setFile(next)
    const head = header ? next.rows[0] ?? [] : []
    const w = Math.max(0, ...next.rows.map((r) => r.length))
    setMapping(defaultMapping(Array.from({ length: w }, (_, i) => head[i]?.trim() ?? ''), targets))
  }

  const toggleHeader = (on: boolean) => {
    setHeader(on)
    if (!file) return
    const head = on ? file.rows[0] ?? [] : []
    setMapping(defaultMapping(Array.from({ length: width }, (_, i) => head[i]?.trim() ?? ''), targets))
  }

  const run = async () => {
    setError(null)
    setProgress({ done: 0, total: data.length })
    try {
      let collections: string[] | undefined
      if (into === 'newCollection') {
        const c = await api.createCollection(collectionName, [type.id])
        collections = [c.name]
      }
      for (let i = 0; i < data.length; i++) {
        const { title, values } = csvRecord(data[i], mapping, targets)
        // No template: the file's values are the object (our choice).
        await api.createObject(type.id, { title, templateId: 'none', values: collections ? { ...values, collections } : values })
        setProgress({ done: i + 1, total: data.length })
      }
      reset()
      onOpenChange(false)
    } catch (e) {
      setProgress(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const busy = progress !== null
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-h-[85vh] w-[min(600px,calc(100vw-32px))] overflow-y-auto border-line bg-raised-2 text-fg">
        <DialogHeader>
          <DialogTitle className="text-[17px]">{IMPORT_CSV_TEXT.heading}</DialogTitle>
          <DialogDescription className="text-[14px] text-fg-muted">{IMPORT_CSV_TEXT.description}</DialogDescription>
        </DialogHeader>
        <label className="flex h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-[14px] text-fg-muted hover:bg-hover">
          <Icon name="ph-file-csv" size={20} />
          <span>{file ? file.name : IMPORT_CSV_TEXT.chooseFile}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label={IMPORT_CSV_TEXT.chooseFile}
            disabled={busy}
            className="sr-only"
            onChange={(e) => void read(e.target.files?.[0])}
          />
        </label>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium">{IMPORT_CSV_TEXT.headerRow}</p>
            <p className="text-[13px] text-fg-muted">{IMPORT_CSV_TEXT.headerRowDescription}</p>
          </div>
          <Switch aria-label={IMPORT_CSV_TEXT.headerRow} checked={header} disabled={busy} onCheckedChange={toggleHeader} />
        </div>
        <div role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <p className="text-[14px] font-medium">{IMPORT_CSV_TEXT.warningHeading}</p>
          <p className="text-[13px] text-fg-muted">{IMPORT_CSV_TEXT.warningText}</p>
        </div>
        {file?.error && (
          <p role="alert" className="text-[13px] text-amber-400">
            {IMPORT_CSV_TEXT.readingError}
          </p>
        )}
        {tooMany && (
          <p role="alert" className="text-[13px] text-red-400">
            {IMPORT_CSV_TEXT.notSupported(CSV_ROW_LIMIT)}
          </p>
        )}
        {file && !tooMany && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[14px]">
              <span>{IMPORT_CSV_TEXT.info(data.length, type.pluralName)}</span>
              <select
                aria-label="Import into"
                value={into}
                disabled={busy}
                onChange={(e) => setInto(e.target.value === 'newCollection' ? 'newCollection' : 'type')}
                className="h-8 min-w-0 rounded-md border border-line bg-raised px-2 text-[14px]"
              >
                <option value="type">{type.pluralName}</option>
                <option value="newCollection">{IMPORT_CSV_TEXT.newCollection(collectionName)}</option>
              </select>
            </div>
            <section aria-label={IMPORT_CSV_TEXT.mappings} className="flex flex-col gap-1.5">
              <h3 className="text-[13px] font-semibold text-fg-muted">{IMPORT_CSV_TEXT.mappings}</h3>
              <p className="text-[13px] text-fg-muted">{IMPORT_CSV_TEXT.mappingsDescription}</p>
              {columns.map((name, i) => (
                <div key={i} className="flex items-center gap-2 text-[14px]">
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <span aria-hidden className="text-fg-muted">
                    →
                  </span>
                  <select
                    aria-label={`Map ${name}`}
                    value={mapping[i] ?? ''}
                    disabled={busy}
                    onChange={(e) => setMapping((m) => columns.map((_, j) => (j === i ? e.target.value || null : m[j] ?? null)))}
                    className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-[14px]"
                  >
                    <option value="">{CHANGE_TYPE_TEXT.none}</option>
                    {targets.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </section>
          </>
        )}
        {progress && (
          <p role="status" className="text-[13px] text-fg-muted">
            {`${IMPORT_CSV_TEXT.importing} ${progress.done} / ${progress.total}`}
          </p>
        )}
        {error && (
          <p role="alert" className="text-[13px] text-red-400">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              reset()
              onOpenChange(false)
            }}
          >
            {IMPORT_CSV_TEXT.cancel}
          </Button>
          <Button disabled={busy || !file || tooMany || data.length === 0} onClick={() => void run()}>
            {IMPORT_CSV_TEXT.import}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
