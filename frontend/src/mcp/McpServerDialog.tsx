/**
 * M19: the "Add MCP server" / "Edit MCP server" dialog of Settings > Integrations > MCP servers.
 * A server connects by Command (stdio: command, arguments one per line, environment rows) or by
 * URL (HTTP or SSE, header rows, a bearer token). Each environment or header row has a "Secret"
 * checkbox, on for new rows. A stored secret is never sent back to the page: it shows as
 * "•••••• saved" with "Replace", and the row sends `value: null` (keep) unless a new value was
 * typed. The bearer sends `bearerAction` keep, set or remove. The form lives inside the dialog's
 * content, which unmounts on close, so a typed secret is never kept after the dialog closes.
 */
import { useState, type FormEvent } from 'react'
import { api } from '@/api/client'
import type { McpServer, McpServerInput, McpServerKind, McpTransport } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { OptionCards, SaveError, errorText } from '@/settings/controls'
import { MCP_TEXT as T } from './mcpText'

interface Row {
  uid: number
  name: string
  value: string
  secret: boolean
  /** The secret is stored on this computer (editing only). */
  stored: boolean
  replacing: boolean
}

let nextUid = 1

function newRow(): Row {
  return { uid: nextUid++, name: '', value: '', secret: true, stored: false, replacing: false }
}

function storedRow(name: string, value: string | null, secret: boolean, set: boolean): Row {
  return { uid: nextUid++, name, value: secret ? '' : (value ?? ''), secret, stored: secret && set, replacing: false }
}

/** A row's value to send: `null` keeps a stored secret (also for an empty replacement). */
function rowValue(r: Row): string | null {
  if (r.secret && (r.value === '' || (r.stored && !r.replacing))) return null
  return r.value
}

const showsSaved = (r: Row) => r.secret && r.stored && !r.replacing

function Rows({
  section,
  rows,
  onChange,
}: {
  section: string
  rows: Row[]
  onChange(rows: Row[]): void
}) {
  const patch = (uid: number, p: Partial<Row>) => onChange(rows.map((r) => (r.uid === uid ? { ...r, ...p } : r)))
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-[13px] font-semibold text-fg">{section}</legend>
      {rows.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto] gap-x-2 text-[12px] text-fg-muted">
          <span>{T.rowName}</span>
          <span>{T.rowValue}</span>
          <span>{T.secret}</span>
          <span />
        </div>
      )}
      {rows.map((r, i) => {
        const n = i + 1
        return (
          <div key={r.uid} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto_auto] items-center gap-x-2">
            <Input
              aria-label={`${section} ${T.rowName} ${n}`}
              value={r.name}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => patch(r.uid, { name: e.target.value })}
              className="h-8 font-mono text-[13px]"
            />
            {showsSaved(r) ? (
              <span className="flex min-w-0 items-center gap-2 text-[12px] text-fg-muted">
                <span className="truncate">{T.savedSecret}</span>
                <button
                  type="button"
                  aria-label={`${T.replace} ${section} ${n}`}
                  onClick={() => patch(r.uid, { replacing: true, value: '' })}
                  className="text-fg underline-offset-2 hover:underline"
                >
                  {T.replace}
                </button>
              </span>
            ) : (
              <Input
                aria-label={`${section} ${T.rowValue} ${n}`}
                type={r.secret ? 'password' : 'text'}
                value={r.value}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => patch(r.uid, { value: e.target.value })}
                className="h-8 font-mono text-[13px]"
              />
            )}
            <Checkbox
              aria-label={`${section} ${T.secret} ${n}`}
              checked={r.secret}
              onCheckedChange={(v) => patch(r.uid, { secret: v === true, replacing: r.stored || r.replacing })}
              className="justify-self-center"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`${T.removeRow} ${section} ${n}`}
              onClick={() => onChange(rows.filter((x) => x.uid !== r.uid))}
            >
              <Icon name="ph-x" size={14} />
            </Button>
          </div>
        )
      })}
      <div>
        <Button type="button" variant="outline" size="sm" aria-label={`${T.addRow}: ${section}`} onClick={() => onChange([...rows, newRow()])}>
          <Icon name="ph-plus" size={14} />
          {T.addRow}
        </Button>
      </div>
    </fieldset>
  )
}

type BearerMode = 'keep' | 'replace' | 'remove'

function ServerForm({
  server,
  onSaved,
  onCancel,
}: {
  server: McpServer | null
  onSaved(s: McpServer): void
  onCancel(): void
}) {
  const editing = server !== null
  const [name, setName] = useState(server?.name ?? '')
  const [enabled, setEnabled] = useState(server?.enabled ?? true)
  const [kind, setKind] = useState<McpServerKind>(server?.kind ?? 'command')
  const [command, setCommand] = useState(server?.command ?? '')
  const [argsText, setArgsText] = useState((server?.args ?? []).join('\n'))
  const [env, setEnv] = useState<Row[]>(() => (server?.env ?? []).map((r) => storedRow(r.key, r.value, r.secret, r.set)))
  const [transport, setTransport] = useState<McpTransport>(server?.transport ?? 'http')
  const [url, setUrl] = useState(server?.url ?? '')
  const [headers, setHeaders] = useState<Row[]>(() =>
    (server?.headers ?? []).map((r) => storedRow(r.name, r.value, r.secret, r.set)),
  )
  const savedBearer = server?.bearer === true
  const [bearerMode, setBearerMode] = useState<BearerMode>('keep')
  const [bearer, setBearer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const bearerOut = (): Pick<McpServerInput, 'bearer' | 'bearerAction'> => {
    if (kind !== 'url') return { bearer: null, bearerAction: 'keep' }
    if (bearer !== '' && (!savedBearer || bearerMode !== 'keep')) return { bearer, bearerAction: 'set' }
    if (savedBearer && bearerMode === 'remove') return { bearer: null, bearerAction: 'remove' }
    return { bearer: null, bearerAction: 'keep' }
  }

  const input = (): McpServerInput => {
    const byCommand = kind === 'command'
    return {
      name: name.trim(),
      enabled,
      kind,
      command: byCommand ? command.trim() : null,
      args: byCommand
        ? argsText
            .split(/\r?\n/)
            .map((a) => a.trim())
            .filter((a) => a !== '')
        : [],
      env: byCommand ? env.map((r) => ({ key: r.name.trim(), value: rowValue(r), secret: r.secret })) : [],
      transport: byCommand ? null : transport,
      url: byCommand ? null : url.trim(),
      headers: byCommand ? [] : headers.map((r) => ({ name: r.name.trim(), value: rowValue(r), secret: r.secret })),
      ...bearerOut(),
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const saved = server ? await api.saveMcpServer(server.id, input(), server.revision) : await api.createMcpServer(input())
      onSaved(saved)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  const fieldClass = 'flex flex-col gap-1 text-[13px] font-semibold text-fg'

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className={fieldClass}>
          {T.name}
          <Input
            autoFocus={!editing}
            value={name}
            readOnly={editing}
            spellCheck={false}
            autoComplete="off"
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
            className="font-mono text-[13px] font-normal"
          />
        </label>
        {editing && <p className="text-[12px] text-fg-muted">{T.nameFixed}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-fg">{T.connectBy}</span>
        <OptionCards<McpServerKind>
          label={T.connectBy}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'command', label: T.byCommand },
            { value: 'url', label: T.byUrl },
          ]}
        />
      </div>

      {kind === 'command' ? (
        <>
          <label className={fieldClass}>
            {T.command}
            <Input
              value={command}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setCommand(e.target.value)}
              className="font-mono text-[13px] font-normal"
            />
          </label>
          <label className={fieldClass}>
            {T.arguments}
            <Textarea
              value={argsText}
              rows={3}
              spellCheck={false}
              placeholder={T.argumentsHint}
              onChange={(e) => setArgsText(e.target.value)}
              className="font-mono text-[13px] font-normal"
            />
          </label>
          <Rows section={T.environment} rows={env} onChange={setEnv} />
        </>
      ) : (
        <>
          <label className={fieldClass}>
            {T.url}
            <Input
              type="text"
              value={url}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setUrl(e.target.value)}
              className="font-mono text-[13px] font-normal"
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-fg">{T.transport}</span>
            <OptionCards<McpTransport>
              label={T.transport}
              value={transport}
              onChange={setTransport}
              options={[
                { value: 'http', label: T.transportHttp },
                { value: 'sse', label: T.transportSse },
              ]}
            />
          </div>
          <Rows section={T.headers} rows={headers} onChange={setHeaders} />
          {savedBearer && bearerMode === 'keep' ? (
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-semibold text-fg">{T.bearer}</span>
              <span className="flex items-center gap-3 text-[12px] text-fg-muted">
                {T.savedSecret}
                <button
                  type="button"
                  aria-label={`${T.replace} ${T.bearer}`}
                  onClick={() => setBearerMode('replace')}
                  className="text-fg underline-offset-2 hover:underline"
                >
                  {T.replace}
                </button>
                <button
                  type="button"
                  aria-label={`${T.remove} ${T.bearer}`}
                  onClick={() => setBearerMode('remove')}
                  className="text-fg underline-offset-2 hover:underline"
                >
                  {T.remove}
                </button>
              </span>
            </div>
          ) : (
            <label className={fieldClass}>
              {T.bearer}
              <Input
                type="password"
                value={bearer}
                autoComplete="off"
                onChange={(e) => setBearer(e.target.value)}
                className="font-mono text-[13px] font-normal"
              />
            </label>
          )}
        </>
      )}

      <div className="flex items-center gap-2 text-[13px] font-semibold text-fg">
        <Switch aria-label={T.turnedOn} checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
        <span>{T.turnedOn}</span>
      </div>

      <SaveError error={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {T.cancel}
        </Button>
        <Button type="submit" disabled={busy}>
          {T.save}
        </Button>
      </div>
    </form>
  )
}

export function McpServerDialog({
  open,
  onOpenChange,
  server,
  onSaved,
}: {
  open: boolean
  onOpenChange(o: boolean): void
  server?: McpServer | null
  onSaved(s: McpServer): void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-h-[85vh] overflow-y-auto border-line bg-raised-2 text-fg sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{server ? T.editTitle : T.addTitle}</DialogTitle>
        </DialogHeader>
        {open && (
          <ServerForm
            key={server?.id ?? 'new'}
            server={server ?? null}
            onCancel={() => onOpenChange(false)}
            onSaved={(s) => {
              onSaved(s)
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
