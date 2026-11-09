// "Version control" (Space group, 2026-11-08): put the open space in a git repository, see what
// was last committed, commit now, open Space history, and set the remote it backs up to (any git
// remote: GitHub, GitLab or a self-hosted server; Object uses the system's git credentials and
// never stores a token). Everything goes through `/api/vcs` (`api/vcsClient.ts`).
import { useEffect, useState } from 'react'
import { vcsApi, type VcsStatus } from '@/api/vcsClient'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { useTabs } from '@/nav/tabs'
import { useVcsStatus } from '@/vcs/useVcsStatus'
import { formatWhen, subject, VCS_TEXT } from '@/vcs/vcsText'
import { SaveError, SectionHeader, SettingGroup, SwitchRow, errorText } from '../controls'
import { useSettingsModal } from '../useSettingsModal'

export const VERSION_CONTROL_TEXT = VCS_TEXT

const T = VCS_TEXT

export const VERSION_CONTROL_SEARCH: string[] = [T.enabled, T.remote, T.pushNow, T.commitNow, T.openHistory, 'git', 'backup']

export const COMMIT_DELAYS = [30, 60, 120, 300, 600, 1800]
export const PUSH_DELAYS = [300, 600, 1800, 3600]

function minutes(seconds: number): string {
  return seconds < 60 ? `${seconds} seconds` : seconds === 60 ? '1 minute' : `${Math.round(seconds / 60)} minutes`
}

const selectClass = 'h-8 w-fit rounded-md border border-line bg-raised px-2 text-[14px] text-fg outline-none focus:border-fg-muted'
const inputClass = 'h-9 w-full max-w-[420px] rounded-md border border-line bg-raised px-2 text-[14px] text-fg outline-none focus:border-fg-muted'

export function VersionControlSection() {
  const status = useVcsStatus((s) => s.space)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [branch, setBranch] = useState('')

  useEffect(() => {
    void useVcsStatus
      .getState()
      .refresh()
      .finally(() => setLoaded(true))
  }, [])
  useEffect(() => {
    setUrl(status?.remote?.url ?? '')
    setBranch(status?.remote?.branch ?? '')
  }, [status?.remote?.url, status?.remote?.branch])

  const run = async (fn: () => Promise<VcsStatus | { status: VcsStatus } | unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fn()
      const next = res && typeof res === 'object' && 'status' in res ? (res as { status: VcsStatus }).status : (res as VcsStatus)
      if (next && typeof next === 'object' && 'target' in next) useVcsStatus.getState().set(next)
      else await useVcsStatus.getState().refresh()
    } catch (e) {
      setError(errorText(e))
      await useVcsStatus.getState().refresh()
    } finally {
      setBusy(false)
    }
  }

  const header = <SectionHeader icon="ph-git-branch" heading={T.heading} description={T.description} />
  if (!loaded && !status) return <div>{header}</div>
  if (status && !status.gitAvailable) {
    return (
      <div>
        {header}
        <SettingGroup title={T.gitMissing} help={T.gitMissingHelp} />
      </div>
    )
  }
  if (!status?.enabled) {
    return (
      <div>
        {header}
        <SettingGroup title={T.enable} help={T.enableHelp}>
          <div>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run(() => vcsApi.enable('space'))}>
              <Icon name="ph-git-branch" size={14} />
              {T.enable}
            </Button>
          </div>
          <SaveError error={error} />
        </SettingGroup>
      </div>
    )
  }

  const remote = status.remote ?? null
  const settings = status.settings
  const otherRemotes = Object.entries(status.remotes ?? {}).filter(([name]) => name !== remote?.name)

  return (
    <div>
      {header}
      <SwitchRow title={T.enabled} help={T.enabledHelp} checked onChange={(v) => !v && void run(() => vcsApi.disable('space'))}>
        <div className="flex flex-col gap-1 text-[14px]" data-vcs-summary="">
          <div>
            <span className="text-fg-muted">{T.lastCommit}: </span>
            {status.lastCommit ? (
              <span className="text-fg">
                {subject(status.lastCommit.message)} · {formatWhen(status.lastCommit.at)}
              </span>
            ) : (
              <span className="text-fg">{T.noCommit}</span>
            )}
          </div>
          <div className="text-fg-muted">{status.pending ? T.pending(status.pending) : T.upToDate}</div>
          {status.warning && <div className="text-[13px] text-fg-muted">{status.warning}</div>}
          {status.ignoresObjectFolder && <div className="text-[13px] text-[var(--danger)]">{T.ignoresObject}</div>}
          {status.error && (
            <p role="alert" className="text-[13px] text-[var(--danger)]">
              {status.error.message}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run(() => vcsApi.commit('space'))}>
            <Icon name="ph-git-commit" size={14} />
            {T.commitNow}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              useSettingsModal.getState().close()
              useTabs.getState().open({ kind: 'spaceHistory' })
            }}
          >
            <Icon name="ph-clock-counter-clockwise" size={14} />
            {T.openHistory}
          </Button>
        </div>
      </SwitchRow>
      {settings && (
        <SettingGroup title={T.commitDelay} help={T.commitDelayHelp}>
          <select
            aria-label={T.commitDelay}
            value={settings.commitDelaySeconds}
            className={selectClass}
            onChange={(e) => void run(() => vcsApi.setSettings({ commitDelaySeconds: Number(e.target.value) }))}
          >
            {[...new Set([...COMMIT_DELAYS, settings.commitDelaySeconds])].sort((a, b) => a - b).map((s) => (
              <option key={s} value={s}>
                {minutes(s)}
              </option>
            ))}
          </select>
        </SettingGroup>
      )}
      <SettingGroup title={T.remote} help={T.remoteHelp}>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void run(() => vcsApi.setRemote('space', url.trim(), branch.trim() || null))
          }}
        >
          <input aria-label={T.remote} value={url} placeholder={T.remotePlaceholder} onChange={(e) => setUrl(e.target.value)} className={inputClass} />
          <input
            aria-label={T.branch}
            value={branch}
            placeholder={`${T.branchPlaceholder}${status.branch ? ` (${status.branch})` : ''}`}
            onChange={(e) => setBranch(e.target.value)}
            className={`${inputClass} max-w-[240px]`}
          />
          <div>
            <Button type="submit" variant="outline" size="sm" disabled={busy}>
              {T.saveRemote}
            </Button>
          </div>
        </form>
        {otherRemotes.length > 0 && !remote && (
          <p className="text-[13px] text-fg-muted">
            {T.existingRemotes}
            {otherRemotes.map(([name, u]) => `${name} (${u})`).join(', ')}
          </p>
        )}
        <div className="text-[14px]" data-vcs-remote="">
          {remote ? <RemoteLine remote={remote} /> : <span className="text-fg-muted">{T.noRemote}</span>}
        </div>
        {remote && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run(() => vcsApi.push('space'))}>
              <Icon name="ph-cloud-arrow-up" size={14} />
              {T.pushNow}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run(() => vcsApi.pull('space'))}>
              <Icon name="ph-cloud-arrow-down" size={14} />
              {T.fetchNow}
            </Button>
          </div>
        )}
        <SaveError error={error} />
      </SettingGroup>
      {remote && (
        <SwitchRow title={T.autoPush} help={T.autoPushHelp} checked={remote.autoPush} onChange={(v) => void run(() => vcsApi.setAutoPush('space', v))}>
          {remote.autoPush && settings && (
            <label className="flex items-center gap-2 text-[14px] text-fg-muted">
              {T.pushDelay}
              <select
                aria-label={T.pushDelay}
                value={settings.pushDelaySeconds}
                className={selectClass}
                onChange={(e) => void run(() => vcsApi.setSettings({ pushDelaySeconds: Number(e.target.value) }))}
              >
                {[...new Set([...PUSH_DELAYS, settings.pushDelaySeconds])].sort((a, b) => a - b).map((s) => (
                  <option key={s} value={s}>
                    {minutes(s)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </SwitchRow>
      )}
    </div>
  )
}

function RemoteLine({ remote }: { remote: NonNullable<VcsStatus['remote']> }) {
  const parts: string[] = []
  if (remote.diverged) {
    return (
      <p role="alert" className="text-[var(--danger)]">
        {T.diverged(remote.ahead ?? 0, remote.behind ?? 0)}
      </p>
    )
  }
  if (remote.neverPushed) parts.push(T.neverPushed)
  else if (remote.ahead) parts.push(T.ahead(remote.ahead))
  else if (remote.behind) parts.push(T.behind(remote.behind))
  else parts.push(T.inSync)
  if (remote.lastPush) parts.push(`${T.lastPush}: ${formatWhen(remote.lastPush)}`)
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-fg">
        {remote.name} · {remote.branch}
      </span>
      <span className="text-fg-muted">{parts.join(' · ')}</span>
      {remote.blocked && <span className="text-[13px] text-fg-muted">{remote.blocked}</span>}
    </div>
  )
}
