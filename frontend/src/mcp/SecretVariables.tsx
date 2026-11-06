/**
 * M19: Settings > Integrations > Secret variables: the values for `${NAME}` references in agent
 * folders' `.mcp.json` files, kept on this computer only (`var:<NAME>` in the state-dir secrets
 * file). Each row shows the name, "Set" or "Missing", who uses it, and "Set…" / "Replace…" and
 * "Delete". A name Object can't set (it comes from this computer's environment) shows a note
 * instead. Values are never shown. The list reloads on `mcpServers` and `agents` events.
 *
 * "Set…" / "Replace…" open the agent page's `SetSecretDialog`, so both places share one dialog.
 */
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { SecretVar } from '@/api/types'
import { Button } from '@/components/ui/button'
import { SaveError, SettingGroup, errorText } from '@/settings/controls'
import { MCP_TEXT as T } from './mcpText'
import { SetSecretDialog } from './SetSecretDialog'

export function SecretVariables() {
  const [vars, setVars] = useState<SecretVar[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [setting, setSetting] = useState<string | null>(null)

  const load = useCallback(() => {
    api
      .mcpSecrets()
      .then((list) => {
        setVars(list)
        setError(null)
      })
      .catch((e: unknown) => setError(errorText(e)))
  }, [])

  useEffect(() => {
    load()
    const off = api.onChange((e) => {
      if (e.kind === 'mcpServers' || e.kind === 'agents') load()
    })
    return () => off?.()
  }, [load])

  const remove = (name: string) => {
    setError(null)
    api
      .deleteMcpSecret(name)
      .then(load)
      .catch((e: unknown) => setError(errorText(e)))
  }

  return (
    <SettingGroup title={T.secretVariables} help={T.secretVariablesHelp}>
      {vars && vars.length > 0 && (
        <ul aria-label={T.secretVariables} className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {vars.map((v) => (
            <li key={v.name} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="truncate font-mono text-[13px] text-fg">{v.name}</span>
                  {v.settable && (
                    <span className={v.set ? 'text-[12px] text-fg-muted' : 'text-[12px] text-[var(--danger)]'}>
                      {v.set ? T.varSet : T.varMissing}
                    </span>
                  )}
                </p>
                {!v.settable && <p className="text-[12px] text-fg-muted">{T.fromEnvironment}</p>}
                {v.usedBy.length > 0 && <p className="truncate text-[12px] text-fg-muted">{T.usedBy(v.usedBy)}</p>}
              </div>
              {v.settable && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`${v.set ? T.replaceVar : T.setVar} ${v.name}`}
                  onClick={() => setSetting(v.name)}
                >
                  {v.set ? T.replaceVar : T.setVar}
                </Button>
              )}
              {v.settable && v.set && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`${T.deleteVar} ${v.name}`}
                  onClick={() => remove(v.name)}
                >
                  {T.deleteVar}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <SaveError error={error} />
      <SetSecretDialog name={setting} onOpenChange={(o) => !o && setSetting(null)} onSaved={load} />
    </SettingGroup>
  )
}
