/**
 * M17: "New agent". Name, icon, description, instructions (the agent's `CLAUDE.md`), model, the
 * tool switches (from `GET /agent-tools`, so a new agent starts with the catalogue's defaults: the
 * shell off) and the folder (inside Object's agents folder by default, or a typed path, as Create
 * space has). "Start from" picks a blank agent or a duplicate of one, which copies its soul and
 * settings and, when ticked, its memory and skills. A 422 or 409 shows the server's message.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '@/api/client'
import type { Agent, Icon as IconValue, ToolGroup } from '@/api/types'
import { IconOrEmoji, isIconifyId } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ModelPicker } from '@/ai/ModelPicker'
import { AGENT_TEXT as T } from './agentText'
import { ToolSwitches } from './ToolSwitches'
import { useAgents } from './useAgents'

export interface NewAgentDialogProps {
  open: boolean
  onOpenChange(o: boolean): void
  /** Opened from a row's "Duplicate": start from a duplicate of this agent. */
  duplicateOf?: Agent | null
}

/** The new agent's icon until one is picked (`agentmodel.NEW_AGENT_ICON`). */
export const NEW_AGENT_ICON = 'ph-robot'
/** The longest name `agent.json` accepts (`agentmodel.NAME_MAX`). */
const NAME_MAX = 60
/** The longest description (`agentmodel.DESCRIPTION_MAX`). */
const DESCRIPTION_MAX = 500

/** An agent's icon string as the icon picker's value. */
export function iconValue(icon: string | null): IconValue | null {
  if (!icon) return null
  return isIconifyId(icon) ? { type: 'iconify', val: icon } : { type: 'emoji', val: icon }
}

/** The switched-off ids of a served catalogue (its default states). */
export function offOf(groups: ToolGroup[]): string[] {
  return groups.flatMap((g) => g.tools.filter((t) => !t.on).map((t) => t.id))
}

type Start = 'blank' | 'duplicate'
type Where = 'state' | 'chosen'

export function NewAgentDialog({ open, onOpenChange, duplicateOf }: NewAgentDialogProps) {
  const agents = useAgents((s) => s.agents)
  const [start, setStart] = useState<Start>('blank')
  const [sourceId, setSourceId] = useState<string>('')
  const [memory, setMemory] = useState(false)
  const [skills, setSkills] = useState(false)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<string | null>(NEW_AGENT_ICON)
  const [iconOpen, setIconOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [model, setModel] = useState<string | null>(null)
  const [groups, setGroups] = useState<ToolGroup[]>([])
  const [defaultOff, setDefaultOff] = useState<string[]>([])
  const [off, setOff] = useState<string[]>([])
  const [where, setWhere] = useState<Where>('state')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const source = start === 'duplicate' ? agents.find((a) => a.id === sourceId) ?? null : null

  /** Fill the fields from `a` (a duplicate's source), or the blank defaults. */
  const fillFrom = (a: Agent | null, catalogueOff: string[]) => {
    setName(a ? T.copyName(a.name) : '')
    setIcon(a ? a.icon : NEW_AGENT_ICON)
    setDescription(a ? a.description : '')
    setModel(a && !a.default ? a.model : null)
    setOff(a ? [...a.toolsOff] : catalogueOff)
  }

  useEffect(() => {
    if (!open) return
    if (!useAgents.getState().loaded) void useAgents.getState().load()
    setStart(duplicateOf ? 'duplicate' : 'blank')
    setSourceId(duplicateOf?.id ?? '')
    setMemory(false)
    setSkills(false)
    setInstructions('')
    setWhere('state')
    setLocation('')
    setError(null)
    setBusy(false)
    fillFrom(duplicateOf ?? null, [])
    let live = true
    void api.agentToolDefaults().then(
      (g) => {
        if (!live) return
        setGroups(g)
        const d = offOf(g)
        setDefaultOff(d)
        if (!duplicateOf) setOff(d)
      },
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      live = false
    }
  }, [open, duplicateOf])

  const pickStart = (next: Start) => {
    setStart(next)
    if (next === 'blank') {
      setSourceId('')
      fillFrom(null, defaultOff)
    } else {
      const first = sourceId || agents[0]?.id || ''
      setSourceId(first)
      fillFrom(agents.find((a) => a.id === first) ?? null, defaultOff)
    }
  }

  const pickSource = (id: string) => {
    setSourceId(id)
    fillFrom(agents.find((a) => a.id === id) ?? null, defaultOff)
  }

  const trimmed = name.trim()
  const ready =
    trimmed !== '' &&
    trimmed.length <= NAME_MAX &&
    (where === 'state' || location.trim() !== '') &&
    (start === 'blank' || source !== null) &&
    !busy

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await api.createAgent({
        agent: { name: trimmed, icon, description, model, toolsOff: off },
        instructions: source ? '' : instructions,
        location: where === 'state' ? null : location.trim(),
        duplicateOf: source ? { id: source.id, memory, skills } : null,
      })
      await useAgents.getState().load()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const field = 'h-9 rounded-md border border-line bg-transparent px-2 text-[14px] font-normal outline-none focus:border-fg-muted'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-line bg-raised-2 text-fg sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{T.newTitle}</DialogTitle>
          <DialogDescription className="text-[14px] text-fg-muted">{T.newIntro}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[13px] font-semibold">{T.startFrom}</legend>
            <div className="flex gap-4 text-[14px]">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="agent-start" checked={start === 'blank'} onChange={() => pickStart('blank')} />
                {T.blank}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="agent-start" checked={start === 'duplicate'} onChange={() => pickStart('duplicate')} />
                {T.duplicateOf}
              </label>
            </div>
            {start === 'duplicate' && (
              <div className="flex flex-col gap-2 pl-5">
                <select
                  aria-label={T.duplicateSource}
                  value={sourceId}
                  onChange={(e) => pickSource(e.target.value)}
                  className={field}
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-[14px]">
                  <Checkbox checked={memory} onCheckedChange={(c) => setMemory(c === true)} aria-label={T.copyMemory} />
                  {T.copyMemory}
                </label>
                <label className="flex items-center gap-2 text-[14px]">
                  <Checkbox checked={skills} onCheckedChange={(c) => setSkills(c === true)} aria-label={T.copySkills} />
                  {T.copySkills}
                </label>
              </div>
            )}
          </fieldset>

          <div className="flex items-end gap-2">
            <Popover open={iconOpen} onOpenChange={setIconOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={T.icon}
                  title={T.icon}
                  className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line hover:bg-hover"
                >
                  <IconOrEmoji icon={icon} fallback={NEW_AGENT_ICON} size={18} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto border-line bg-raised p-2 text-fg">
                <IconPicker
                  value={iconValue(icon)}
                  onChange={(next) => {
                    setIconOpen(false)
                    setIcon(next ? next.val : null)
                  }}
                />
              </PopoverContent>
            </Popover>
            <label className="flex flex-1 flex-col gap-1 text-[13px] font-semibold">
              {T.name}
              <input
                autoFocus
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                className={field}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            {T.description}
            <textarea
              value={description}
              maxLength={DESCRIPTION_MAX}
              rows={2}
              onChange={(e) => setDescription(e.target.value)}
              className="rounded-md border border-line bg-transparent px-2 py-1.5 text-[14px] font-normal outline-none focus:border-fg-muted"
            />
          </label>

          {source ? (
            <p className="text-[13px] text-fg-muted">{T.copiedInstructions(source.name)}</p>
          ) : (
            <label className="flex flex-col gap-1 text-[13px] font-semibold">
              {T.instructions}
              <textarea
                value={instructions}
                rows={5}
                placeholder={T.instructionsPlaceholder}
                onChange={(e) => setInstructions(e.target.value)}
                className="rounded-md border border-line bg-transparent px-2 py-1.5 text-[14px] font-normal outline-none focus:border-fg-muted"
              />
            </label>
          )}

          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold">{T.model}</span>
            <ModelPicker value={model} onChange={setModel} defaultLabel={T.defaultModel} ariaLabel={T.model} />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold">{T.tools}</span>
            <ToolSwitches groups={groups} off={off} onChange={setOff} disabled={busy} />
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[13px] font-semibold">{T.folder}</legend>
            <label className="flex items-center gap-1.5 text-[14px]">
              <input type="radio" name="agent-folder" checked={where === 'state'} onChange={() => setWhere('state')} />
              {T.inStateDir}
            </label>
            <label className="flex items-center gap-1.5 text-[14px]">
              <input type="radio" name="agent-folder" checked={where === 'chosen'} onChange={() => setWhere('chosen')} />
              {T.chooseFolder}
            </label>
            {where === 'chosen' && (
              <input
                aria-label={T.folderPath}
                value={location}
                spellCheck={false}
                onChange={(e) => setLocation(e.target.value)}
                className={`${field} ml-5 font-mono text-[13px]`}
              />
            )}
          </fieldset>

          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {T.cancel}
            </Button>
            <Button type="submit" disabled={!ready}>
              {T.create}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
