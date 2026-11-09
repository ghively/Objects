/**
 * M20: a remote agent's Profile tab. Name and icon each save on change with the agent's revision
 * (`saveRemoteAgent`); on a 409 the tab reloads the agent, as M17's Profile does. "Agent Card"
 * shows the card URL (read-only) with "Refresh card", where messages go and the A2A version. A
 * refreshed card whose endpoint moved to another host or scheme is not switched to (Gene,
 * 2026-11-08): the section says where it moved, with "Switch to the new address" and "Keep the old
 * one"; after a switch an agent that had a token is asked for it again, as when adding.
 * "Authentication" shows the auth as "set" (never its value) or "Token: needed"; "Replace token…"
 * opens the auth fields in place. "Context sent" says when context was first sent. "Folder" has
 * "Open folder" and "Remove from list". A remote agent has no soul, memory, skills, model or tool
 * switches of Object's (spec section 1), so none of those are here.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, ConflictError } from '@/api/client'
import type { Agent, RemoteAuthInput } from '@/api/types'
import { IconOrEmoji } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { authInput, authReady, EMPTY_AUTH, RemoteAuthFields, type AuthDraft } from './AddRemoteAgentDialog'
import { REMOTE_TEXT as T } from './agentText'
import { chatDate } from './ChatsTab'
import { iconValue } from './NewAgentDialog'
import { putAgent, reloadAgent } from './ProfileTab'
import { useAgents } from './useAgents'

/** The longest name `agent.json` accepts (`agentmodel.NAME_MAX`). */
const NAME_MAX = 60

/** How the agent's auth reads: "None", "Bearer token: set", "Header {name}: set" or "Token: needed". */
export function authStatus(agent: Agent): string {
  const auth = agent.remote?.auth
  if (!auth || auth.kind === 'none') return T.authNoneSet
  if (!auth.set) return T.authNeeded
  return auth.kind === 'bearer' ? T.authBearerSet : T.authHeaderSet(auth.headerName ?? '')
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-1">
      <h3 className="text-[13px] font-semibold">{label}</h3>
      {children}
    </section>
  )
}

export function RemoteProfileTab({ agent }: { agent: Agent }) {
  const latest = useRef(agent)
  latest.current = agent
  const [name, setName] = useState(agent.name)
  const [iconOpen, setIconOpen] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [auth, setAuth] = useState<AuthDraft>(EMPTY_AUTH)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const remote = agent.remote

  useEffect(() => setName(agent.name), [agent.name])

  const save = async (patch: { name?: string; icon?: string | null; auth?: RemoteAuthInput | null }): Promise<boolean> => {
    const cur = latest.current
    setError(null)
    setNotice(null)
    try {
      const next = await api.saveRemoteAgent(cur.id, {
        name: patch.name ?? cur.name,
        icon: 'icon' in patch ? patch.icon : cur.icon,
        color: cur.color,
        auth: patch.auth ?? null,
        baseRevision: cur.revision ?? '',
      })
      latest.current = next
      putAgent(next)
      return true
    } catch (e) {
      if (e instanceof ConflictError) {
        setNotice(T.conflict)
        await reloadAgent(cur.id)
      } else {
        setError(message(e))
      }
      return false
    }
  }

  const commitName = () => {
    const next = name.replace(/\s+/g, ' ').trim()
    if (!next) return setName(agent.name)
    if (next !== agent.name) void save({ name: next })
  }

  const closeReplace = () => {
    setReplacing(false)
    setAuth(EMPTY_AUTH)
  }

  const saveAuth = async () => {
    if (!authReady(auth) || busy) return
    setBusy(true)
    const ok = await save({ auth: authInput(auth) })
    setBusy(false)
    // The value is never shown again: the fields close and forget it.
    if (ok) closeReplace()
  }

  const refresh = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const next = await api.refreshRemoteAgent(agent.id)
      latest.current = next
      putAgent(next)
      setNotice(T.refreshed)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  /** "Switch to the new address": the pending endpoint becomes the one messages go to; an agent
   * that had a token is asked for it again (the move dropped it), the way adding asks. */
  const switchAddress = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const next = await api.confirmRemoteEndpoint(agent.id)
      latest.current = next
      putAgent(next)
      const kind = next.remote?.auth.kind ?? 'none'
      if (kind !== 'none') {
        setAuth({ kind, headerName: next.remote?.auth.headerName ?? '', value: '' })
        setReplacing(true)
        setNotice(T.switchedNeedsToken)
      } else {
        setNotice(T.switched)
      }
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  /** "Keep the old one": forgets the pending endpoint; messages keep going where they did. */
  const keepAddress = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const next = await api.dismissRemoteEndpoint(agent.id)
      latest.current = next
      putAgent(next)
      setNotice(T.keptAddress)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const reveal = async () => {
    setError(null)
    try {
      await api.revealAgentFolder(agent.id)
    } catch (e) {
      setError(message(e))
    }
  }

  const remove = async () => {
    setError(null)
    try {
      await api.unregisterAgent(agent.id)
      setNotice(T.removed)
      await useAgents.getState().load()
    } catch (e) {
      setError(message(e))
    }
  }

  if (!remote) return null
  const field = 'h-9 rounded-md border border-line bg-transparent px-2 text-[14px] font-normal outline-none focus:border-fg-muted'

  return (
    <div className="flex flex-col gap-5" data-agent-tab="remoteProfile">
      <div className="flex items-end gap-2">
        <Popover open={iconOpen} onOpenChange={setIconOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={T.icon}
              title={T.icon}
              className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line hover:bg-hover"
            >
              <IconOrEmoji icon={agent.icon} fallback="ph-globe" size={18} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto border-line bg-raised p-2 text-fg">
            <IconPicker
              value={iconValue(agent.icon)}
              onChange={(next) => {
                setIconOpen(false)
                void save({ icon: next ? next.val : null })
              }}
            />
          </PopoverContent>
        </Popover>
        <label className="flex flex-1 flex-col gap-1 text-[13px] font-semibold">
          {T.name}
          <input
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitName()
              }
            }}
            className={field}
          />
        </label>
      </div>

      <Section label={T.agentCard}>
        <div className="flex items-center gap-2">
          <input
            readOnly
            aria-label={T.cardUrl}
            value={remote.cardUrl}
            title={remote.cardUrl}
            className={`${field} min-w-0 flex-1 font-mono text-[13px]`}
          />
          <Button type="button" variant="outline" disabled={busy} onClick={() => void refresh()}>
            {T.refreshCard}
          </Button>
        </div>
        <p className="text-[14px]">{T.sendsTo(remote.endpointHost)}</p>
        <p className="text-[14px] text-fg-muted">{T.protocol(remote.protocolVersion)}</p>
        {remote.pendingEndpoint && (
          <div className="mt-1 flex flex-col gap-2 rounded-md border border-line px-3 py-2">
            <p className="text-[14px]" title={remote.pendingEndpoint.url}>
              {T.moved(remote.pendingEndpoint.host)}
            </p>
            <div className="flex gap-2">
              <Button type="button" disabled={busy} onClick={() => void switchAddress()}>
                {T.switchAddress}
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => void keepAddress()}>
                {T.keepAddress}
              </Button>
            </div>
          </div>
        )}
      </Section>

      <Section label={T.authentication}>
        <p data-auth-status="" className="text-[14px]">
          {authStatus(agent)}
        </p>
        {replacing ? (
          <div className="flex flex-col gap-2 rounded-md border border-line px-3 py-2">
            <RemoteAuthFields value={auth} onChange={setAuth} disabled={busy} name={`remote-auth-${agent.id}`} />
            <div className="flex gap-2">
              <Button type="button" disabled={!authReady(auth) || busy} onClick={() => void saveAuth()}>
                {T.save}
              </Button>
              <Button type="button" variant="ghost" onClick={closeReplace}>
                {T.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button type="button" variant="outline" onClick={() => setReplacing(true)}>
              {T.replaceToken}
            </Button>
          </div>
        )}
      </Section>

      <Section label={T.contextSent}>
        <p className="text-[14px]">{remote.contextNoticeAt ? T.firstSent(chatDate(remote.contextNoticeAt)) : T.notYet}</p>
      </Section>

      <Section label={T.folder}>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-line px-2 py-1.5 text-[13px]" title={agent.folder}>
            {agent.folder}
          </code>
          <Button type="button" variant="outline" onClick={() => void reveal()} disabled={!agent.exists || agent.missing}>
            {T.openFolder}
          </Button>
        </div>
        <div className="pt-1">
          <Button type="button" variant="outline" onClick={() => void remove()}>
            {T.removeFromList}
          </Button>
        </div>
      </Section>

      {notice && (
        <p role="status" className="text-[13px] text-fg-muted">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
