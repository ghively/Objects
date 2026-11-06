/**
 * M19: Settings > Integrations > MCP servers: the outside MCP servers every agent on this
 * computer can use, stored in the app's state folder (never a space). Each row has its enabled
 * switch, its name and summary, the last test, and "Test", "Edit" and "Delete" (which turns into
 * "Confirm delete", as Revoke does). The switch saves `enabled` with the server's revision and,
 * on a 409, reloads and retries once. The list reloads on `mcpServers` events. The secret
 * variables list follows the servers.
 */
import { useCallback, useEffect, useState } from 'react'
import { api, ConflictError } from '@/api/client'
import type { McpServer, McpServerInput, McpTestResult as McpTestResultData } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { SaveError, SettingGroup, errorText } from '@/settings/controls'
import { McpServerDialog } from './McpServerDialog'
import { McpTestResult } from './McpTestResult'
import { SecretVariables } from './SecretVariables'
import { MCP_TEXT as T } from './mcpText'

/** A server's input as stored: every stored secret kept (`value: null`), the bearer kept. */
function inputFromServer(server: McpServer, patch: Partial<McpServerInput> = {}): McpServerInput {
  return {
    name: server.name,
    enabled: server.enabled,
    kind: server.kind,
    command: server.command,
    args: [...server.args],
    env: server.env.map((r) => ({ key: r.key, value: r.secret ? null : r.value, secret: r.secret })),
    transport: server.transport,
    url: server.url,
    headers: server.headers.map((r) => ({ name: r.name, value: r.secret ? null : r.value, secret: r.secret })),
    bearer: null,
    bearerAction: 'keep',
    ...patch,
  }
}

function summary(s: McpServer): string {
  if (s.kind === 'url') return T.urlSummary(s.url ?? '', s.transport ?? 'http')
  return [s.command ?? '', ...s.args].join(' ').trim()
}

function lastTestLine(r: McpTestResultData | null): string | null {
  if (!r) return null
  return r.ok ? T.toolCount(r.tools.length) : T.testFailed(r.error ?? '')
}

export function McpServersGroup() {
  const [servers, setServers] = useState<McpServer[] | null>(null)
  const [readOnly, setReadOnly] = useState<string | null>(null)
  const [unreadable, setUnreadable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [results, setResults] = useState<Record<string, McpTestResultData>>({})
  const [dialog, setDialog] = useState<{ open: boolean; server: McpServer | null }>({ open: false, server: null })

  const load = useCallback(async (): Promise<McpServer[] | null> => {
    try {
      const r = await api.mcpServers()
      setServers(r.servers)
      setReadOnly(r.readOnlyReason)
      setUnreadable(r.unreadable)
      return r.servers
    } catch (e) {
      setError(errorText(e))
      return null
    }
  }, [])

  useEffect(() => {
    void load()
    const off = api.onChange((e) => {
      if (e.kind === 'mcpServers') void load()
    })
    return () => off?.()
  }, [load])

  const toggle = async (s: McpServer, enabled: boolean) => {
    setError(null)
    setServers((list) => list?.map((x) => (x.id === s.id ? { ...x, enabled } : x)) ?? list)
    try {
      await api.saveMcpServer(s.id, inputFromServer(s, { enabled }), s.revision)
    } catch (e) {
      if (!(e instanceof ConflictError)) {
        setError(errorText(e))
        void load()
        return
      }
      // Stale revision: reload and retry once with the server as it is now.
      const fresh = (await load())?.find((x) => x.id === s.id)
      if (!fresh) return
      try {
        await api.saveMcpServer(fresh.id, inputFromServer(fresh, { enabled }), fresh.revision)
      } catch (e2) {
        setError(errorText(e2))
      }
    }
    void load()
  }

  const test = (s: McpServer) => {
    setTesting((t) => ({ ...t, [s.id]: true }))
    api
      .testMcpServer(s.id)
      .then((r) => setResults((all) => ({ ...all, [s.id]: r })))
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => setTesting((t) => ({ ...t, [s.id]: false })))
  }

  const remove = (s: McpServer) => {
    if (confirming !== s.id) {
      setConfirming(s.id)
      return
    }
    setConfirming(null)
    setError(null)
    api
      .deleteMcpServer(s.id)
      .then(() => load())
      .catch((e: unknown) => setError(errorText(e)))
  }

  return (
    <>
      <SettingGroup title={T.heading} help={T.help}>
        {readOnly && <p className="text-[13px] text-fg-muted">{readOnly}</p>}
        {servers && servers.length === 0 && !readOnly && (
          <p className="text-[13px] text-fg-muted">{unreadable ? T.unreadable : T.empty}</p>
        )}
        {servers && servers.length > 0 && (
          <ul aria-label={T.heading} className="flex flex-col divide-y divide-line rounded-lg border border-line">
            {servers.map((s) => {
              const shown = results[s.id] ?? s.lastTest
              const line = lastTestLine(shown)
              const busy = testing[s.id] === true
              const confirmingThis = confirming === s.id
              return (
                <li key={s.id} className="flex flex-col gap-2 px-3 py-2">
                  <div className="flex items-center gap-3">
                    <Switch
                      aria-label={`${T.enabled} ${s.name}`}
                      checked={s.enabled}
                      disabled={readOnly !== null}
                      onCheckedChange={(v) => void toggle(s, v === true)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[14px] text-fg">{s.name}</p>
                      <p className="truncate font-mono text-[12px] text-fg-muted">{summary(s)}</p>
                      {confirmingThis ? (
                        <p className="text-[12px] text-fg-muted">{T.deleteHelp}</p>
                      ) : (
                        line && (
                          <p className={shown?.ok ? 'text-[12px] text-fg-muted' : 'truncate text-[12px] text-[var(--danger)]'}>{line}</p>
                        )
                      )}
                    </div>
                    <Button type="button" variant="outline" size="sm" aria-label={`${T.test} ${s.name}`} disabled={busy} onClick={() => test(s)}>
                      {T.test}
                    </Button>
                    {!readOnly && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`${T.edit} ${s.name}`}
                        onClick={() => setDialog({ open: true, server: s })}
                      >
                        {T.edit}
                      </Button>
                    )}
                    {!readOnly && (
                      <Button
                        type="button"
                        variant={confirmingThis ? 'destructive' : 'outline'}
                        size="sm"
                        aria-label={`${confirmingThis ? T.confirmDelete : T.delete} ${s.name}`}
                        onClick={() => remove(s)}
                        onBlur={() => setConfirming((c) => (c === s.id ? null : c))}
                      >
                        {confirmingThis ? T.confirmDelete : T.delete}
                      </Button>
                    )}
                  </div>
                  {(busy || results[s.id]) && (
                    <div className="pl-11">
                      <McpTestResult result={results[s.id] ?? null} testing={busy} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {!readOnly && servers && (
          <div>
            <Button type="button" size="sm" onClick={() => setDialog({ open: true, server: null })}>
              <Icon name="ph-plus" size={14} />
              {T.add}
            </Button>
          </div>
        )}
        <SaveError error={error} />
        <McpServerDialog
          open={dialog.open}
          server={dialog.server}
          onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
          onSaved={() => void load()}
        />
      </SettingGroup>
      <SecretVariables />
    </>
  )
}
