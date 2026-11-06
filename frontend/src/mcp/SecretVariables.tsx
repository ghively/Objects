/**
 * M19: Settings > Integrations > Secret variables: the values for `${NAME}` references in agent
 * folders' `.mcp.json` files, kept on this computer only (`var:<NAME>` in the state-dir secrets
 * file). Each row shows the name, "Set" or "Missing", who uses it, and "Set…" / "Replace…" and
 * "Delete". A name Object can't set (it comes from this computer's environment) shows a note
 * instead. Values are never shown. The list reloads on `mcpServers` and `agents` events.
 *
 * `LocalSetSecretDialog` has the props of the agent page's `SetSecretDialog` (built in another
 * lane); the integration step swaps that one in.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '@/api/client'
import type { SecretVar } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SaveError, SettingGroup, errorText } from '@/settings/controls'
import { MCP_TEXT as T } from './mcpText'

function LocalSetSecretDialog({
  name,
  onOpenChange,
  onSaved,
}: {
  name: string | null
  onOpenChange(o: boolean): void
  onSaved?(): void
}) {
  return (
    <Dialog open={name !== null} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="border-line bg-raised-2 text-fg sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{name !== null ? T.setTitle(name) : ''}</DialogTitle>
        </DialogHeader>
        {name !== null && (
          <SetForm
            key={name}
            name={name}
            onCancel={() => onOpenChange(false)}
            onSaved={() => {
              onSaved?.()
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Unmounts with the dialog's content, so the typed value never outlives the dialog. */
function SetForm({ name, onCancel, onSaved }: { name: string; onCancel(): void; onSaved(): void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (value === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.setMcpSecret(name, value)
      setValue('')
      onSaved()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-[13px] font-semibold">
        {T.value}
        <Input
          type="password"
          autoComplete="off"
          autoFocus
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="font-normal"
        />
      </label>
      <SaveError error={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {T.cancel}
        </Button>
        <Button type="submit" disabled={value === '' || busy}>
          {T.save}
        </Button>
      </div>
    </form>
  )
}

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
      <LocalSetSecretDialog name={setting} onOpenChange={(o) => !o && setSetting(null)} onSaved={load} />
    </SettingGroup>
  )
}
