import { z } from 'zod'
import type { Icon } from './blocks.model.js'
import type { UIDataTypes, UIMessage } from 'ai'
import type { ExtendedAITools } from '../util/ai-tools.model.js'
import type { QueuedDelta } from '../util/block-content-delta-editing.model.js'

/** @deprecated Used only for the legacy 24h budget. Replaced by monthly per-plan budgets. */
export const AI_ASSISTANT_BUDGET_TIME_FRAME = 1000 * 60 * 60 * 24 // 24 hours

/**
 * Monthly AI budget in USD for paid plans without Turbo Plus.
 * Free users get 0 (no AI access). Turbo Plus budgets are computed dynamically
 * from the user's local catalog price — see getMonthlyBudgetUsd() in ai-budget-service.ts.
 */
export const MONTHLY_BUDGET_USD_BY_PLAN = {
  pro: 1.0,
  believer: 2.0,
  trial: 0.5,
} as const

/**
 * Global multiplier applied to every AI usage cost before it is deducted from
 * the user's budget. Values > 1 mean the user's budget drains faster than the
 * raw provider cost, giving us a margin on every AI call (including top-up
 * credits). Set to 1.0 to disable the margin.
 */
export const AI_BUDGET_USAGE_MULTIPLIER = 1.1

/** Top-up pack sizes in USD. Each purchase grants this amount of non-resetting AI credit. */
export const TOP_UP_PACK_USD = [5, 10, 20, 50] as const
export type TopUpPackUsd = (typeof TOP_UP_PACK_USD)[number]

/** Default auto-recharge trigger: recharge when balance drops below this fraction of the pack size. */
export const AUTO_RECHARGE_DEFAULT_THRESHOLD_USD = 2.0

// Capacities budget model for cloud hosting
export type CapacitiesCloudProvider = 'azure' | 'vertex'
export type CapacitiesModelDeployment = 'eu' | 'worldwide'
export type CapacitiesModelUsageMode = 'budget' | 'medium' | 'turbo'
/** Usage modes the auto model router may select (excludes turbo). */
export type AutoRoutedUsageMode = Extract<CapacitiesModelUsageMode, 'budget' | 'medium'>
export interface CapacitiesModelDefinition {
  cloudProvider: CapacitiesCloudProvider
  provider: AIAssistantChatModelProvider
  modelId: string
  deployment: CapacitiesModelDeployment
  usageMode: CapacitiesModelUsageMode
}

export const aiModelProviders = ['openai', 'gemini', 'anthropic', 'mistral', 'xai', 'deepseek', 'moonshot'] as const
export const aiModelProvidersFrontend = [
  'openai',
  'gemini',
  'anthropic',
  'mistral',
  'xai',
  'deepseek',
  'moonshot',
] as const

export const CAPACITIES_AI_PROVIDER = 'openai' as const
export const CAPACITIES_AI_AUTO_MODEL_KEY = 'auto' as const
export const CAPACITIES_AI_CHEAP_MODEL_KEY = 'cheap' as const
export const FALLBACK_AI_PROVIDER = 'openai' as const

export const aiAssistantChatModelProviderSchema = z.preprocess(
  (value) => (value === 'perplexity' ? FALLBACK_AI_PROVIDER : value),
  z.enum(aiModelProviders)
)
export type AIAssistantChatModelProvider = (typeof aiModelProviders)[number]

export const validOpenAIErrorCodes = ['401', '429', '404']

export type CapAIAssistant = {
  provider: AIAssistantChatModelProvider
  modelName: string
  maxTokens: number
  costPerUnit: number
}

export const capacitiesAIProviderLabels: Partial<Record<(typeof aiModelProvidersFrontend)[number], string>> = {
  openai: 'Open AI',
  gemini: 'Gemini',
  anthropic: 'Anthropic',
  mistral: 'Mistral',
  xai: 'xAI',
  deepseek: 'DeepSeek',
  moonshot: 'Moonshot',
}

export const capacitiesAIModelIcons: Record<(typeof aiModelProvidersFrontend)[number], Icon> = {
  openai: {
    type: 'iconify',
    val: 'ph-open-ai-logo',
    color: 'violet',
  },
  gemini: {
    type: 'iconify',
    val: 'ph-star-four-fill',
    color: 'blue',
  },
  anthropic: {
    type: 'iconify',
    val: 'logos-claude-icon',
    color: 'orange',
  },
  mistral: {
    type: 'iconify',
    val: 'logos-mistral-ai-icon',
    color: 'amber',
  },
  xai: {
    type: 'iconify',
    val: 'logos-x-ai',
  },
  deepseek: {
    type: 'iconify',
    val: 'logos-deepseek-icon',
  },
  moonshot: {
    type: 'iconify',
    val: 'logos-moonshot-ai-icon',
  },
}

export const aiAssistantRoleSchema = z.enum(['system', 'user', 'assistant'])
export type AIAssistantRole = z.infer<typeof aiAssistantRoleSchema>

export const aiAssistantMessageDto = z.object({
  role: aiAssistantRoleSchema,
  content: z.string(),
})
export type AIAssistantMessageDto = z.infer<typeof aiAssistantMessageDto>

export const budgetCategorySchema = z.enum([
  'pdfAnalysis',
  'imageAnalysis',
  'imageGeneration',
  'audioAnalysis',
  'weblinkAnalysis',
  'aiChat',
  'propertyAutofill',
  'aiPanel',
])
export type BudgetCategory = z.infer<typeof budgetCategorySchema>

export const budgetBreakdownSchema = z.object({
  pdfAnalysis: z.number(),
  imageAnalysis: z.number(),
  imageGeneration: z.number().optional(),
  audioAnalysis: z.number(),
  weblinkAnalysis: z.number(),
  aiChat: z.number(),
  propertyAutofill: z.number(),
  aiPanel: z.number(),
})
export type BudgetBreakdown = z.infer<typeof budgetBreakdownSchema>

export const capacitiesAIKeyBudgetSchema = z.record(
  z.string(),
  z.object({
    usedBudget: z.number(),
    maxBudget: z.number().optional(),
    isCapacitiesAI: z.boolean(),
    lastResetTime: z.string(),
    /** Non-resetting top-up credit balance in USD. Consumed after the monthly allowance. */
    topUpBalanceUsd: z.number().optional(),
    /** Corresponding balance in the user's local currency (for display only). */
    topUpBalanceLocal: z.number().optional(),
    /** ISO 4217 currency code for topUpBalanceLocal (e.g. 'EUR', 'GBP'). */
    topUpLocalCurrency: z.string().optional(),
    /** ISO 8601 timestamp of when the budget next resets. Computed server-side
     *  so the frontend never needs to know whether the system is in V1 (daily)
     *  or V2 (monthly) mode. */
    nextResetAt: z.string().optional(),
    /** Per-feature spending breakdown for the current period. */
    breakdown: budgetBreakdownSchema.optional(),
  })
)
export type CapacitiesAIKeyBudget = z.infer<typeof capacitiesAIKeyBudgetSchema>

/** Auto-recharge settings stored on the user identity. */
export const autoRechargeSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Top-up pack size in USD to purchase on auto-recharge. */
  packUsd: z.number(),
  /** Trigger a recharge when effective remaining budget drops below this USD value. */
  thresholdUsd: z.number(),
  /** Maximum number of auto-recharges allowed per billing month. */
  monthlyRechargeCap: z.number().int().min(1),
  /** Number of auto-recharges already triggered in the current billing window. */
  monthlyRechargeCount: z.number().int().min(0),
  /** ISO timestamp of the start of the current monthly spend window. */
  spendWindowStart: z.string(),
  /** ISO timestamp of when the user last consented to auto-recharge. */
  consentTimestamp: z.string().optional(),
})
export type AutoRechargeSettings = z.infer<typeof autoRechargeSettingsSchema>

export type AIAssistantPreferences = {
  state: 'active' | 'hidden' | 'inactive'
  /**
   * Hides AI inside the Capacities app while `state` stays `active`, so MCP and other
   * connections keep working. Only set together with `active`. Fully off and hidden is `state: 'hidden'`.
   */
  hiddenInApp?: boolean | undefined
  activeSpaces?: { spaceId: string }[] | undefined
  preferredLanguages?: {
    primary: string | undefined
    secondary: string | undefined
  }
  providerChoices?: { spaceId: string; provider: AIAssistantChatModelProvider }[] | undefined
  useCapacitiesBudget?: boolean | undefined
  /** Autofill new movies, series and books from external sources once their title is set. */
  autofillOnCreate?: boolean | undefined
}

export type AIChatMessageContext =
  | {
      type: 'entity'
      id: string
    }
  | {
      type: 'entities'
      ids: string[]
    }
  | {
      type: 'blocks'
      id: string
      blockIdentifiers: {
        id: string
        bId: string
        textSelection?: {
          isCollapsed: boolean | undefined
          start: {
            offset: number
            tIndex: number
          }
          end: {
            offset: number
            tIndex: number
          }
        }
      }[]
    }
  | undefined

export type AIPromptVariableResult =
  | {
      type: 'text'
      label: string
      value: string
      variableName: string
      placeholder?: string
    }
  | {
      type: 'list'
      label: string
      value: string
      variableName: string
      customValueAllowed?: boolean
      values: readonly string[]
    }

/** Where an attachment's bytes live. Attachments travel as references, never as inline bytes. */
export type ChatAttachmentSource =
  | {
      kind: 'secondary-file'
      entityId: string
      fileId: string
      /**
       * Namespace and ending locate the S3 object from the ref alone. The portal signs the
       * attachment straight from these instead of reading the parent's synced `secondaryFiles`
       * map, so a turn resolves the moment the bytes are in S3 — with no wait for the upload's
       * status to round-trip through the entity sync engine.
       */
      namespace: string
      fileEnding: string
    }
  | { kind: 'file-resource'; entityId: string; resourceName: string }

export type ChatAttachmentDelivery = 'file' | 'inline-text'

export type ChatAttachmentRef = {
  /** Stable id. The message's file part points here via `capacities-attachment:<attachmentId>`. */
  attachmentId: string
  source: ChatAttachmentSource
  /**
   * Downscaled derivative used only for the model payload, present when the original
   * exceeded the per-image byte cap. Rendering and download always use `source`.
   */
  modelSource?: ChatAttachmentSource
  /** Verified byte size of modelSource; required whenever a derivative is present. */
  modelFileSize?: number
  mediaType: string
  filename: string
  fileSize: number
  delivery: ChatAttachmentDelivery
  width?: number
  height?: number
}

/**
 * The downscaled derivative (source + verified size), or `undefined` when absent or inconsistent.
 * `modelFileSize` must be a positive finite number whenever `modelSource` is set; a derivative
 * without a trustworthy size cannot be used for the model payload.
 */
export function getModelDerivative(
  ref: ChatAttachmentRef
): { source: ChatAttachmentSource; fileSize: number } | undefined {
  if (!ref.modelSource) return undefined
  const fileSize = ref.modelFileSize
  if (typeof fileSize !== 'number' || !Number.isFinite(fileSize) || fileSize <= 0) return undefined
  return { source: ref.modelSource, fileSize }
}

export type ExtendedUIMessageMetadata = {
  /** ISO 8601 timestamp when the message was created. Optional for older chats. */
  createdAt?: string
  systemMessageType?: 'mainPrompt' | 'context' | undefined
  command?:
    | {
        key: string
        variableResults?: AIPromptVariableResult[] | undefined
      }
    | undefined
  chatContext?: AIChatMessageContext
  /** References attached to this user turn; snapshotted from the composer at send time. */
  attachedContext?: AIChatMessageContext
  /**
   * Rich-text segmentation of the user's authored message: an ordered mix of plain-text
   * chunks and inline mention chips. Emitted by the composer. When present, UIs should
   * render this inline (e.g. using EntityLabel for mentions) and fall back to plain
   * text when absent.
   */
  contentSegments?: Array<{ type: 'text'; text: string } | { type: 'mention'; entityId: string }>
  reasoning?: string | undefined
  sources?: Array<{ id: string; title?: string; url?: string }> | undefined
  /**
   * RootQuery entity ids created via "Save as Query" on a generateQuery preview in this
   * message, keyed by toolCallId. Kept in metadata so the link survives chat reloads
   * even when the tool is still pending approval (no output yet) or output is rewritten.
   */
  savedQueryIds?: Record<string, string>
  /**
   * Files attached to this user turn, in composer order. Authoritative record joined to
   * the message's file parts by `attachmentId`; the portal resolves these to signed URLs
   * per request so no expiring URL is ever persisted.
   */
  attachments?: ChatAttachmentRef[]
}

export type ExtendedUIMessage = UIMessage<ExtendedUIMessageMetadata, UIDataTypes, ExtendedAITools>

export type AIAssistantChat = {
  /**
   * Stable client-side identifier for this chat object. Generated once when the
   * chat is first initialized and preserved across the ephemeral→persisted
   * transition (when a sidepanel chat is promoted to a `RootAIChat` entity).
   *
   * Used by the UI as a stable component `:key` so that swapping a sidepanel
   * entry id for a persisted entity id mid-stream does not remount `AIChat`
   * and interrupt a running response.
   */
  clientId?: string
  contextSuggestion?: {
    id: string
  }
  contextSuggestions?: {
    id: string
  }[]
  /**
   * @deprecated Use `draftAttachedContext` (composer) and per-message `metadata.attachedContext`.
   * Kept only for one-shot migration: when a chat opens with this set and `draftAttachedContext`
   * is empty, it is seeded into the composer and then cleared.
   */
  context?: AIChatMessageContext | undefined
  /**
   * Client-only: references currently attached in the composer (draft).
   * Persists visually between sends until user removes chips; snapshotted onto
   * each outgoing user message's `metadata.attachedContext` at send time.
   */
  draftAttachedContext?: AIChatMessageContext
  uiMessages?: ExtendedUIMessage[] | undefined
  /** Client-only: unsent draft text, preserved when switching tabs */
  draftMessage?: string | undefined
  /**
   * Client-only: structured segmentation of the current draft composer content.
   * Mirrors `draftMessage` but preserves inline mention pills (entity ids) so the
   * rich-text editor can be restored exactly when the chat is reopened. Optional —
   * when absent, the composer falls back to rendering `draftMessage` as plain text.
   */
  draftSegments?: ExtendedUIMessageMetadata['contentSegments']
  /**
   * Client-only: attachments returned to the composer by reverting to an earlier message.
   * Mirrors `draftSegments` so an interrupted edit keeps its files across a reload.
   */
  draftAttachments?: ChatAttachmentRef[]
  /**
   * AI-generated short title for the chat (3–6 words). Set once by the auto-title
   * flow after the first assistant response completes. Takes precedence over the
   * first-message-derivation in `getAiChatTitle`; the persisted entity title (for
   * `RootAIChat` entities) is also updated at the same moment so sidebars/tabs
   * reflect it. Never overwritten once the user has manually renamed the chat
   * (guarded by `titleIsCustom`).
   */
  generatedTitle?: string
  /**
   * True once the user has manually renamed the chat/entity. Blocks any future
   * auto-title overwrite. For MVP the auto-title flow only runs once per chat
   * (after the first exchange), so in practice this is only a safety net for
   * potential future "evolving title" behaviour.
   */
  titleIsCustom?: boolean
  contentDeltaState?: {
    sessionId: string
    deltas: QueuedDelta[]
  }
  /** @deprecated */
  messages?: any[]
  /** @deprecated */
  aiModel?: any
  /** @deprecated */
  initialPrompt?: string
}
