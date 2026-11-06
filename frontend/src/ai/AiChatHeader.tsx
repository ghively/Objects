// M16: the AI chat's header row (spec section 10): [leading] · spacer · this chat's model picker ·
// New chat · [menu]. M17 puts its agent picker in `leading`; M18 its `…` menu in `menu`. The context chips sit in the row under it.
import type { ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import { AI_CHAT_TEXT as T } from './aiText'
import { ModelPicker } from './ModelPicker'
import { modelLabel, useAiModels } from './models'

export interface AiChatHeaderProps {
  leading?: ReactNode
  /** This chat's pick (null: Default). */
  model: string | null
  /** The default agent's model (Settings > AI Assistant > Model, `aiModel`); null: Claude Code's own. */
  defaultModel: string | null
  onModelChange(next: string | null): void
  onNewChat(): void
  busy?: boolean
  /** M18: the chat's `…` menu (`ChatMenu`), after New chat. */
  menu?: ReactNode
}

export function AiChatHeader({ leading, model, defaultModel, onModelChange, onNewChat, menu }: AiChatHeaderProps) {
  const models = useAiModels()
  const defaultLabel = defaultModel ? T.defaultModelOf(modelLabel(defaultModel, models, defaultModel)) : T.defaultModel
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-1">
      {leading}
      <div className="min-w-0 flex-1" />
      <ModelPicker value={model} onChange={onModelChange} defaultLabel={defaultLabel} ariaLabel={T.modelForChat} compact />
      <button
        type="button"
        aria-label={T.newChat}
        title={T.newChat}
        onClick={onNewChat}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
      >
        <Icon name="ph-note-pencil" size={15} />
      </button>
      {menu}
    </div>
  )
}
