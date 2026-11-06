/**
 * M18: the agent page's Learning tab (spec section 5's switches and numbers): how often the
 * background reviews run (0 turns one off), the review model ("Same as the chat" by default, spec
 * section 11), the memory caps, and the curator (on, its idle hours and days, and the optional
 * merge pass) with its last and next run. Each field saves on change with the settings' revision
 * (`PUT /agents/{id}/learning`); a 422 shows its message under the field; a 409 reloads and asks
 * for the change again. "Reset to defaults" saves the defaults. A read-only agent's fields are
 * disabled. Opening the tab writes nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ConflictError, RESYNC_PATH } from '@/api/client'
import type { Agent, LearningSettings, LearningState } from '@/api/types'
import { ModelPicker } from '@/ai/ModelPicker'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { LEARNING_TEXT as T, learningDate } from './learningText'
import { PROFILE_TEXT, reloadAgent } from './ProfileTab'

type NumberKey = 'memoryReviewEvery' | 'skillReviewEvery' | 'memoryChars' | 'userChars' | 'curatorIdleHours' | 'curatorEveryDays'

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function NumberField({
  name,
  before,
  after,
  value,
  disabled,
  error,
  onCommit,
}: {
  name: NumberKey
  before: string
  after: string
  value: number
  disabled: boolean
  error: string | undefined
  onCommit(n: number): void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  const commit = () => {
    const text = draft.trim()
    const n = Number(text)
    if (text === '' || !Number.isInteger(n)) return setDraft(String(value))
    if (n !== value) onCommit(n)
  }

  return (
    <div className="flex flex-col gap-1" data-field={name}>
      <label className="flex flex-wrap items-center gap-2 text-[14px]">
        <span>{before}</span>
        <input
          type="number"
          inputMode="numeric"
          step={1}
          value={draft}
          disabled={disabled}
          aria-label={`${before} (${after})`}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
          className="h-8 w-24 rounded-md border border-line bg-transparent px-2 text-[14px] outline-none focus:border-fg-muted disabled:opacity-60"
        />
        <span>{after}</span>
      </label>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function SwitchField({
  label,
  checked,
  disabled,
  error,
  onChange,
}: {
  label: string
  checked: boolean
  disabled: boolean
  error: string | undefined
  onChange(on: boolean): void
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-[14px]">
        <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
        <span>{label}</span>
      </label>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export function LearningTab({ agent }: { agent: Agent }) {
  const [state, setState] = useState<LearningState | null>(null)
  const [errors, setErrors] = useState<Partial<Record<keyof LearningSettings | 'reset', string>>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const latest = useRef<LearningState | null>(null)
  const id = agent.id
  const disabled = agent.readOnlyReason !== null

  const load = useCallback(async () => {
    try {
      const res = await api.agentLearning(id)
      latest.current = res
      setState(res)
      setLoadError(null)
    } catch (e) {
      setLoadError(message(e))
    }
  }, [id])

  useEffect(() => {
    let live = true
    void load()
    const off = api.onChange((e) => {
      if (live && e.kind === 'agentLearning' && (e.path === id || e.path === RESYNC_PATH)) void load()
    })
    return () => {
      live = false
      off()
    }
  }, [load, id])

  const save = async (patch: Partial<LearningSettings>, field: keyof LearningSettings | 'reset') => {
    const cur = latest.current
    if (!cur) return
    setNotice(null)
    setErrors((e) => {
      const { [field]: _gone, ...rest } = e
      return rest
    })
    try {
      const next = await api.saveAgentLearning(id, { ...cur.settings, ...patch }, cur.revision)
      latest.current = next
      setState(next)
      // `agent.json` changed: the agent's own revision moved too.
      void reloadAgent(id)
    } catch (e) {
      if (e instanceof ConflictError) {
        setNotice(PROFILE_TEXT.conflict)
        await load()
      } else {
        setErrors((errs) => ({ ...errs, [field]: message(e) }))
      }
    }
  }

  if (!state) {
    return (
      <div data-agent-tab="learning">
        {loadError ? (
          <p role="alert" className="text-[13px] text-danger">
            {loadError}
          </p>
        ) : (
          <p className="text-[14px] text-fg-muted">{T.loading}</p>
        )}
      </div>
    )
  }

  const s = state.settings
  const num = (name: NumberKey, before: string, after: string) => (
    <NumberField
      name={name}
      before={before}
      after={after}
      value={s[name]}
      disabled={disabled}
      error={errors[name]}
      onCommit={(n) => void save({ [name]: n }, name)}
    />
  )
  const curator = state.curator

  return (
    <div className="flex flex-col gap-6" data-agent-tab="learning">
      <section className="flex flex-col gap-2" aria-labelledby="learning-reviews">
        <h3 id="learning-reviews" className="text-[15px] font-semibold">
          {T.reviews}
        </h3>
        {num('memoryReviewEvery', T.reviewMemoryBefore, T.reviewMemoryAfter)}
        {num('skillReviewEvery', T.reviewSkillsBefore, T.reviewSkillsAfter)}
        <p className="text-[13px] text-fg-muted">{T.reviewOff}</p>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="learning-model">
        <h3 id="learning-model" className="text-[15px] font-semibold">
          {T.reviewModel}
        </h3>
        <ModelPicker
          value={s.reviewModel}
          onChange={(model) => void save({ reviewModel: model }, 'reviewModel')}
          defaultLabel={T.reviewModelDefault}
          ariaLabel={T.reviewModel}
          disabled={disabled}
        />
        {errors.reviewModel && (
          <p role="alert" className="text-[13px] text-danger">
            {errors.reviewModel}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="learning-caps">
        <h3 id="learning-caps" className="text-[15px] font-semibold">
          {T.caps}
        </h3>
        {num('memoryChars', T.memoryCapBefore, T.charactersAfter)}
        {num('userChars', T.userCapBefore, T.charactersAfter)}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="learning-curator">
        <h3 id="learning-curator" className="text-[15px] font-semibold">
          {T.curator}
        </h3>
        <SwitchField
          label={T.curatorSwitch}
          checked={s.curator}
          disabled={disabled}
          error={errors.curator}
          onChange={(on) => void save({ curator: on }, 'curator')}
        />
        {num('curatorIdleHours', T.idleBefore, T.idleAfter)}
        {num('curatorEveryDays', T.everyBefore, T.everyAfter)}
        <SwitchField
          label={T.consolidate}
          checked={s.consolidate}
          disabled={disabled}
          error={errors.consolidate}
          onChange={(on) => void save({ consolidate: on }, 'consolidate')}
        />
        <p className="text-[13px] text-fg-muted" data-curator-runs="">
          {curator.lastRunAt ? T.lastRun(learningDate(curator.lastRunAt)) : T.notRun}
          {s.curator && curator.nextDueAt && <span className="block">{T.nextRun(learningDate(curator.nextDueAt))}</span>}
        </p>
      </section>

      <div className="flex flex-col gap-1">
        <div>
          <Button type="button" variant="outline" disabled={disabled} onClick={() => void save({ ...state.defaults }, 'reset')}>
            {T.reset}
          </Button>
        </div>
        {errors.reset && (
          <p role="alert" className="text-[13px] text-danger">
            {errors.reset}
          </p>
        )}
      </div>

      {notice && (
        <p role="status" className="text-[13px] text-fg-muted">
          {notice}
        </p>
      )}
    </div>
  )
}
