// M11 "Integrations": the local API tokens of this space. A token lets a program on this
// computer (an MCP client such as Claude Code or Claude Desktop, or a script) read the space
// and, with a read-write token, change it through `/api/v1`. The secret is shown once, with a
// ready-to-paste MCP config; only a hash is kept (in the app's state folder, never the space).
// Objects marked "Exclude from AI" stay invisible to every token.
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { ApiToken, ApiTokenScope, CreatedApiToken } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { OptionCards, SaveError, SectionHeader, SettingGroup, errorText } from '../controls'

// our strings (no counterpart in the original app)
export const INTEGRATIONS_TEXT = {
  heading: 'Integrations',
  description: 'Let programs on this computer, like an AI assistant, use this space.',
  tokens: 'API tokens',
  tokensHelp:
    'Each token gives one program access to this space through the local API. Objects marked "Exclude from AI" (a tag or the excludeFromAI property) are never shown to it.',
  empty: 'No tokens yet.',
  newToken: 'New token',
  nameLabel: 'Token name',
  namePlaceholder: 'e.g. Claude Code',
  scope: 'Access',
  read: 'Read only',
  readHelp: 'Search, query and read objects.',
  readWrite: 'Read and write',
  readWriteHelp: 'Also create objects, edit properties and sections, rename and move to the trash.',
  create: 'Create token',
  created: 'Copy this token now. It will not be shown again.',
  copyToken: 'Copy token',
  copyConfig: 'Copy MCP config',
  copied: 'Copied',
  done: 'Done',
  revoke: 'Revoke',
  revokeConfirm: 'Confirm revoke',
  revokeHelp: 'Programs using this token lose access at once.',
  lastUsed: 'Last used',
  never: 'Never used',
  mcp: 'Connect an AI assistant',
  mcpHelp:
    'Add this to your MCP client config (Claude Code: .mcp.json, Claude Desktop: claude_desktop_config.json) with the token in place of <token>. Object must be running.',
} as const

const T = INTEGRATIONS_TEXT

export const INTEGRATIONS_SEARCH: string[] = [T.tokens, T.mcp, 'MCP', 'API']

function when(stamp: string | null): string {
  if (!stamp) return T.never
  const d = new Date(stamp)
  return Number.isNaN(d.getTime()) ? stamp : `${T.lastUsed} ${d.toLocaleString()}`
}

function CopyButton({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy}>
      <Icon name={copied ? 'ph-check' : 'ph-copy'} size={14} />
      {copied ? T.copied : label}
    </Button>
  )
}

function Created({ made, onDone }: { made: CreatedApiToken; onDone(): void }) {
  const config = JSON.stringify(made.mcpConfig, null, 2)
  return (
    <div role="status" className="flex flex-col gap-2 rounded-lg border border-line bg-raised p-3">
      <p className="text-[13px] font-semibold text-fg">{T.created}</p>
      <code data-testid="token-secret" className="rounded bg-[var(--bg-raised-2)] px-2 py-1 font-mono text-[12px] break-all text-fg">
        {made.secret}
      </code>
      <pre className="max-h-48 overflow-auto rounded bg-[var(--bg-raised-2)] p-2 font-mono text-[11px] text-fg">{config}</pre>
      <div className="flex flex-wrap gap-2">
        <CopyButton label={T.copyToken} text={made.secret} />
        <CopyButton label={T.copyConfig} text={config} />
        <Button type="button" size="sm" onClick={onDone}>
          {T.done}
        </Button>
      </div>
    </div>
  )
}

export function IntegrationsSection() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null)
  const [template, setTemplate] = useState<string>('')
  const [name, setName] = useState('')
  const [scope, setScope] = useState<ApiTokenScope>('read')
  const [made, setMade] = useState<CreatedApiToken | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = useCallback(() => {
    api
      .apiTokens()
      .then((r) => {
        setTokens(r.tokens)
        setTemplate(JSON.stringify(r.mcp, null, 2))
      })
      .catch((e: unknown) => setError(errorText(e)))
  }, [])

  useEffect(load, [load])

  const create = () => {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    api
      .createApiToken(name.trim(), scope)
      .then((r) => {
        setMade(r)
        setName('')
        load()
      })
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => setBusy(false))
  }

  const revoke = (t: ApiToken) => {
    if (confirming !== t.id) {
      setConfirming(t.id)
      return
    }
    setConfirming(null)
    setError(null)
    api
      .revokeApiToken(t.id)
      .then(load)
      .catch((e: unknown) => setError(errorText(e)))
  }

  return (
    <div>
      <SectionHeader icon="ph-plugs-connected" heading={T.heading} description={T.description} />
      <SettingGroup title={T.tokens} help={T.tokensHelp}>
        {tokens && tokens.length === 0 && <p className="text-[13px] text-fg-muted">{T.empty}</p>}
        {tokens && tokens.length > 0 && (
          <ul aria-label={T.tokens} className="flex flex-col divide-y divide-line rounded-lg border border-line">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                <Icon name="ph-key" size={16} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-fg">{t.name}</p>
                  <p className="text-[12px] text-fg-muted">
                    {confirming === t.id ? T.revokeHelp : `${t.scope === 'read' ? T.read : T.readWrite} · ${when(t.lastUsedAt)}`}
                  </p>
                </div>
                <Button
                  type="button"
                  variant={confirming === t.id ? 'destructive' : 'outline'}
                  size="sm"
                  aria-label={`${confirming === t.id ? T.revokeConfirm : T.revoke} ${t.name}`}
                  onClick={() => revoke(t)}
                  onBlur={() => setConfirming((c) => (c === t.id ? null : c))}
                >
                  {confirming === t.id ? T.revokeConfirm : T.revoke}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SettingGroup>
      <SettingGroup title={T.newToken}>
        {made ? (
          <Created made={made} onDone={() => setMade(null)} />
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              create()
            }}
          >
            <Input
              aria-label={T.nameLabel}
              placeholder={T.namePlaceholder}
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <OptionCards<ApiTokenScope>
              label={T.scope}
              value={scope}
              onChange={setScope}
              options={[
                { value: 'read', label: T.read, description: T.readHelp },
                { value: 'read-write', label: T.readWrite, description: T.readWriteHelp },
              ]}
            />
            <div>
              <Button type="submit" size="sm" disabled={busy || !name.trim()}>
                <Icon name="ph-plus" size={14} />
                {T.create}
              </Button>
            </div>
          </form>
        )}
        <SaveError error={error} />
      </SettingGroup>
      {template && (
        <SettingGroup title={T.mcp} help={T.mcpHelp}>
          <pre className="max-h-48 overflow-auto rounded bg-[var(--bg-raised-2)] p-2 font-mono text-[11px] text-fg">{template}</pre>
          <div>
            <CopyButton label={T.copyConfig} text={template} />
          </div>
        </SettingGroup>
      )}
    </div>
  )
}
