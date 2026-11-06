// M16: one tool step between the chat's messages (spec section 10), collapsed to one line and
// expandable to the call's input and result. Both are shown as React text, never as HTML.
import { useId, useState } from 'react'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { TOOL_STEP_TEXT as T, toolStepLine, type ToolStepState } from './toolSteps'

export function ToolStep({ step }: { step: ToolStepState }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const line = toolStepLine(step)
  const pending = !step.done && !step.stopped
  const failed = (step.done && step.isError) || (!step.done && !!step.stopped)
  const icon = pending ? 'ph-spinner-gap' : failed ? 'ph-warning-circle' : 'ph-check'

  return (
    <div className="my-1" data-tool-step={step.id}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        aria-label={line}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-fg-muted hover:bg-hover"
      >
        <Icon name={open ? 'ph-caret-down' : 'ph-caret-right'} size={12} className="shrink-0" />
        <Icon name={icon} size={13} className={cn('shrink-0', pending && 'animate-spin')} />
        {pending && <span className="sr-only">{T.running}</span>}
        <span className="min-w-0 flex-1 truncate text-[13px]" title={line}>
          {line}
        </span>
      </button>
      {open && (
        <div id={bodyId} className="ml-5 mt-1 space-y-1 text-[12px]">
          <div className="font-medium text-fg-muted">{T.input}</div>
          <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap break-words rounded bg-hover px-2 py-1 font-mono">
            {JSON.stringify(step.input, null, 2)}
          </pre>
          <div className="font-medium text-fg-muted">{T.result}</div>
          {step.result === null ? (
            <div className="text-fg-muted">{T.noResult}</div>
          ) : (
            <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap break-words rounded bg-hover px-2 py-1 font-mono">
              {step.result}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
