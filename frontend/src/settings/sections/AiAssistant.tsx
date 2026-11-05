// M10 "AI Assistant": the catalogued "Hide AI features" switch, plus where the Claude Code CLI is
// (empty = found on PATH), the model passed to it (empty = Claude Code's default) and whether it
// answers (`GET /api/ai/status`) with a Recheck button. Every value is a device setting
// (`useSettings().patch`); the two text fields save on blur (and on Enter).
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { AiStatus, DeviceSettings } from '@/api/types'
import { Icon } from '@/components/Icon'
import { useSettings } from '@/settings/useSettings'
import { SaveError, SecondaryButton, SectionHeader, SettingGroup, SwitchRow, errorText } from '../controls'

export const AI_ASSISTANT_TEXT = {
  heading: 'AI Assistant',
  description: 'Choose whether AI features show and how Object reaches Claude Code.', // our string
  hide: 'Hide AI features',
  hideHelp: 'Hides every AI entry in the app: the AI Chat card, the AI menu entries and the AI shortcuts.', // our string
  path: 'Claude Code path', // our string
  pathHelp: 'Leave empty to use the claude command found on your PATH.', // our string
  pathPlaceholder: 'claude (from PATH)', // our string
  model: 'Model', // our string
  modelHelp: "Leave empty to use Claude Code's default model.", // our string
  modelPlaceholder: 'Default', // our string
  status: 'Status', // our string
  checking: 'Checking…', // our string
  ready: (version: string | null, path: string | null) =>
    `Claude Code${version ? ` ${version}` : ''} is ready${path ? ` (${path})` : ''}.`, // our string
  notFound: 'Claude Code not found', // our string
  notFoundHelp: 'Install Claude Code and sign in, or set its path above.', // our string
  notSignedIn: 'Claude Code is not signed in.', // our string
  recheck: 'Recheck', // our string
} as const

const T = AI_ASSISTANT_TEXT

export const AI_ASSISTANT_SEARCH: string[] = [T.hide, T.path, T.model, 'Claude', 'AI']

/** A text setting saved on blur or Enter; empty saves `null`. A new saved value replaces what is typed. */
function TextSetting({
  label,
  placeholder,
  value,
  onSave,
}: {
  label: string
  placeholder: string
  value: string | null
  onSave(next: string | null): void
}) {
  const [text, setText] = useState(value ?? '')
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    setText(value ?? '')
  }
  const commit = () => {
    const next = text.trim()
    if (next === (value ?? '')) return
    onSave(next === '' ? null : next)
  }
  return (
    <input
      aria-label={label}
      placeholder={placeholder}
      value={text}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
      }}
      className="h-8 w-full max-w-[420px] rounded-md border border-line bg-transparent px-2 text-[14px] text-fg outline-none focus:border-fg-muted"
    />
  )
}

function statusLine(s: AiStatus): { text: string; help?: string; ok: boolean } {
  if (s.available) return { text: T.ready(s.version, s.claudePath), ok: true }
  if (s.reason === 'notFound') return { text: T.notFound, help: T.notFoundHelp, ok: false }
  if (s.reason === 'notSignedIn') return { text: s.message || T.notSignedIn, ok: false }
  return { text: s.message || T.notFound, ok: false }
}

export function AiAssistantSection() {
  const settings = useSettings((s) => s.settings)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [checking, setChecking] = useState(true)
  const seq = useRef(0)

  const run = useCallback((mine: number) => {
    api
      .aiStatus()
      .then((s) => {
        if (mine === seq.current) setStatus(s)
      })
      .catch((e: unknown) => {
        if (mine === seq.current) setStatus({ available: false, reason: 'error', claudePath: null, version: null, message: errorText(e) })
      })
      .finally(() => {
        if (mine === seq.current) setChecking(false)
      })
  }, [])

  useEffect(() => {
    const counter = seq
    run(++counter.current)
    return () => {
      counter.current++
    }
  }, [run])

  const check = () => {
    setChecking(true)
    run(++seq.current)
  }

  const patch = (p: Partial<DeviceSettings>, recheck = false) => {
    setError(null)
    const done = useSettings.getState().patch(p)
    done.catch((e: unknown) => setError(errorText(e)))
    // A new path or model: ask again once it is saved.
    if (recheck) void done.then(check, () => undefined)
  }

  const line = status ? statusLine(status) : null

  return (
    <div>
      <SectionHeader icon="ph-sparkle" heading={T.heading} description={T.description} />
      <SwitchRow title={T.hide} help={T.hideHelp} checked={settings.aiHidden} onChange={(v) => patch({ aiHidden: v })} />
      <SettingGroup title={T.path} help={T.pathHelp}>
        <TextSetting label={T.path} placeholder={T.pathPlaceholder} value={settings.claudePath} onSave={(v) => patch({ claudePath: v }, true)} />
      </SettingGroup>
      <SettingGroup title={T.model} help={T.modelHelp}>
        <TextSetting label={T.model} placeholder={T.modelPlaceholder} value={settings.aiModel} onSave={(v) => patch({ aiModel: v })} />
      </SettingGroup>
      <SettingGroup title={T.status}>
        <div className="flex items-start gap-3">
          <div role="status" aria-label={T.status} className="flex min-w-0 flex-1 items-start gap-2 text-[14px]">
            {checking || !line ? (
              <span className="text-fg-muted">{T.checking}</span>
            ) : (
              <>
                <span className={line.ok ? 'pt-0.5 text-fg' : 'pt-0.5 text-[var(--danger)]'}>
                  <Icon name={line.ok ? 'ph-check-circle' : 'ph-warning-circle'} size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-fg">{line.text}</span>
                  {line.help && <span className="block text-[13px] text-fg-muted">{line.help}</span>}
                </span>
              </>
            )}
          </div>
          <SecondaryButton onClick={check} disabled={checking}>
            <Icon name="ph-arrows-clockwise" size={14} />
            {T.recheck}
          </SecondaryButton>
        </div>
      </SettingGroup>
      <SaveError error={error} />
    </div>
  )
}
