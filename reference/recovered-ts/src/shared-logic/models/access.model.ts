import { contentIdSchema } from './api/general.api.js'
import { ComponentFull } from './component.model.js'
import { z } from 'zod'

export const subscriptionPlanKeySchema = z.enum([
  'capacities-pro-monthly',
  'capacities-pro-yearly',
  'capacities-pro-free',
  'capacities-believer-free',
  'capacities-believer-15-monthly',
  'capacities-believer-15-yearly',
  'capacities-believer-20-monthly',
  'capacities-believer-20-yearly',
  'capacities-believer-30-monthly',
  'capacities-believer-30-yearly',
  'capacities-believer-50-monthly',
  'capacities-believer-50-yearly',
  'capacities-believer-100-monthly',
  'capacities-believer-100-yearly',
])
export type SubscriptionPlanKey = z.infer<typeof subscriptionPlanKeySchema>

const FREE_PLAN_KEYS = [
  'capacities-pro-free',
  'capacities-believer-free',
] as const satisfies readonly SubscriptionPlanKey[]

export function isFreePlanKey(planKey: string | undefined): planKey is (typeof FREE_PLAN_KEYS)[number] {
  return !!planKey && (FREE_PLAN_KEYS as readonly string[]).includes(planKey)
}

export function getFreePlanKeyForTier(plan: 'pro' | 'believer'): SubscriptionPlanKey {
  return plan === 'believer' ? 'capacities-believer-free' : 'capacities-pro-free'
}

export const turboTierSchema = z.enum(['plus'])
export type TurboTier = z.infer<typeof turboTierSchema>

export const turboPlanKeySchema = z.enum(['capacities-turbo-plus-monthly', 'capacities-turbo-plus-yearly'])
export type TurboPlanKey = z.infer<typeof turboPlanKeySchema>

/** One-off top-up pack plan keys used to push prices to Paddle and look them up by id. */
export const topUpPlanKeySchema = z.enum([
  'capacities-ai-topup-5',
  'capacities-ai-topup-10',
  'capacities-ai-topup-20',
  'capacities-ai-topup-50',
])
export type TopUpPlanKey = z.infer<typeof topUpPlanKeySchema>

export function isTopUpPlanKey(planKey: string): planKey is TopUpPlanKey {
  return topUpPlanKeySchema.safeParse(planKey).success
}

export function getTopUpPackUsdFromPlanKey(planKey: TopUpPlanKey): number {
  const match = planKey.match(/capacities-ai-topup-(\d+)/)
  if (!match) throw new Error(`Unknown top-up plan key: ${planKey}`)
  return parseInt(match[1], 10)
}

/** One-off Support Capacities tip plan keys. */
export const SUPPORT_AMOUNTS = [5, 10, 20, 30, 50, 100, 500, 1000] as const
export type SupportAmount = (typeof SUPPORT_AMOUNTS)[number]

export const supportPlanKeySchema = z.enum([
  'capacities-support-5',
  'capacities-support-10',
  'capacities-support-20',
  'capacities-support-30',
  'capacities-support-50',
  'capacities-support-100',
  'capacities-support-500',
  'capacities-support-1000',
])
export type SupportPlanKey = z.infer<typeof supportPlanKeySchema>

export function isSupportPlanKey(planKey: string): planKey is SupportPlanKey {
  return supportPlanKeySchema.safeParse(planKey).success
}

export function getSupportPlanKeyForAmount(amount: SupportAmount): SupportPlanKey {
  return `capacities-support-${amount}` as SupportPlanKey
}

export function getSupportAmountFromPlanKey(planKey: SupportPlanKey): SupportAmount {
  const match = planKey.match(/capacities-support-(\d+)/)
  if (!match) throw new Error(`Unknown support plan key: ${planKey}`)
  const amount = parseInt(match[1], 10)
  if (!(SUPPORT_AMOUNTS as readonly number[]).includes(amount)) {
    throw new Error(`Unknown support amount: ${amount}`)
  }
  return amount as SupportAmount
}

export type CatalogPlanKey = SubscriptionPlanKey | TurboPlanKey | TopUpPlanKey | SupportPlanKey

export function isTurboPlanKey(planKey: string): planKey is TurboPlanKey {
  return turboPlanKeySchema.safeParse(planKey).success
}

export function getTurboPlanKeyForTierAndPeriod(tier: TurboTier, period: 'month' | 'year'): TurboPlanKey {
  if (tier === 'plus') {
    return period === 'month' ? 'capacities-turbo-plus-monthly' : 'capacities-turbo-plus-yearly'
  }
  throw new Error(`Unknown turbo tier: ${tier satisfies never}`)
}

export function getTurboTierFromPlanKey(planKey: TurboPlanKey): TurboTier {
  if (planKey.startsWith('capacities-turbo-plus')) return 'plus'
  throw new Error(`Unknown turbo plan key: ${planKey}`)
}

export function getTurboPeriodFromPlanKey(planKey: TurboPlanKey): 'month' | 'year' {
  return planKey.endsWith('-yearly') ? 'year' : 'month'
}

const principalUserRole = z.union([
  z.object({
    name: z.literal('SpaceEditor'),
    config: z.object({
      spaceId: contentIdSchema,
    }),
  }),
  // !! Admin role is deprecated
  z.object({
    name: z.literal('admin'),
  }),
])
export type PrincipalUserRole = z.infer<typeof principalUserRole>

export const userRoleSchema = z.union([
  principalUserRole,
  z.object({
    name: z.literal('subscription'),
    config: z.object({
      planKey: subscriptionPlanKeySchema,
      expirationDate: z.string().optional(),
    }),
  }),
  z.object({
    name: z.literal('EarlyBeliever'),
  }),
  z.object({
    name: z.literal('subscription-free-trial'),
    config: z.object({
      expirationDate: z.string(),
    }),
  }),
  z.object({
    name: z.literal('subscription-turbo'),
    config: z.object({
      tier: turboTierSchema,
      period: z.enum(['month', 'year']),
      /** Set when Plus is explicitly downgraded. Signals "cancelled" state to
       *  the frontend — the role is kept so a notice can be shown. */
      expirationDate: z.string().optional(),
    }),
  }),
])
export type UserRole = z.infer<typeof userRoleSchema>

export type ComponentPolicy =
  | { name: 'read'; principalType: 'Unconstrained'; principals: string[] }
  | { name: 'read'; principalType: 'Role'; principals: PrincipalUserRole[] }
  | { name: 'read'; principalType: 'User'; principals: string[] }
  | { name: 'write'; principalType: 'Role'; principals: PrincipalUserRole[] }
  | { name: 'write'; principalType: 'User'; principals: string[] }

export type LinkPolicy = { name: 'read'; principalType: 'Unconstrained'; principals: any[] }

export interface ComponentPermissions {
  read: boolean
  edit: boolean
  sync: boolean
  duplicate: boolean
  addEntry: boolean
}

export interface LinkPermissions {
  read: boolean
  edit: boolean
  changePolicies: boolean
}

// Policy Changes
export type PolicyChangeStatus = 'confirmed' | 'denied' | 'notAuthorized'

export type ComponentPolicyChanges = {
  mode: 'add' | 'remove'
  changes: { policy: ComponentPolicy; status: PolicyChangeStatus; hasConflict?: boolean | undefined }[]
}

// Mutation Requests
export type ReadOptions = 'none' | 'unconstrained'

export type LinkVisibility = 'none' | 'unconstrained'

export type PermissionRequestObject = {
  processId?: string | undefined
  messageKey: 'addReadAccess' | 'removeReadAccess' | 'addVisibilityInDatabase' | 'removeVisibilityInDatabase'
  ids: string[]
  policyChanges: ComponentPolicyChanges
  isOnlyNested: boolean // meaning that you do not process certain types
}

export type PermissionChange = PermissionChangeAllowed | PermissionChangeNotAllowed

export type PermissionChangeAllowed = {
  component: ComponentFull
  allowed: true
  policyChanges: ComponentPolicyChanges
  handleEntries: boolean | undefined
}

export type PermissionChangeNotAllowed = {
  component: ComponentFull
  allowed: false
}

export type CloudflareValidationResponse = {
  success: boolean
  errorCodes?: string[]
  challengeTs?: string
  hostname?: string
}
