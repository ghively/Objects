import { z } from 'zod'
import {
  subscriptionPlanKeySchema,
  turboTierSchema,
  SUPPORT_AMOUNTS,
  type SubscriptionPlanKey,
  type TurboTier,
} from '../access.model.js'
import { READWISE_CONTENT_TYPES } from '../readerIntegrations.model.js'
import { componentDto, languageKeySchema } from './content.api.js'
import { contentIdSchema, contentIdSchemaExtended, contentIdSchemaNarrow, structureIdSchema } from './general.api.js'
import { emailSchema } from './user.api.js'

const fileVisibilitySchema = z.enum(['private', 'public'])
export type FileVisibility = z.infer<typeof fileVisibilitySchema>

export const fileUploadDto = z.object({
  id: contentIdSchemaNarrow,
  fileType: z.string().optional(),
  fileEnding: z.string().optional(),
  visibility: fileVisibilitySchema,
})
export type FileUploadDto = z.infer<typeof fileUploadDto>

export const fileUploadMultipartDto = z.object({
  id: contentIdSchemaNarrow,
  fileType: z.string().optional(),
  fileEnding: z.string().optional(),
  fileSize: z.number(),
  visibility: fileVisibilitySchema,
})
export type FileUploadMultipartDto = z.infer<typeof fileUploadMultipartDto>

/** Hard cap per parent entity — bounds sign-on-read work and metadata size. */
export const MAXIMUM_SECONDARY_FILES_PER_PARENT = 1000

const secondaryFileNamespaceSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/)
const secondaryFileStatusSchema = z.enum(['local', 'uploading', 'uploaded', 'delete-requested', 'failed'])
export type SecondaryFileStatus = z.infer<typeof secondaryFileStatusSchema>

const secondaryFileInfoSchema = z.object({
  namespace: secondaryFileNamespaceSchema,
  fileId: contentIdSchemaNarrow,
  mimeType: z.string(),
  fileEnding: z.string(),
  status: secondaryFileStatusSchema,
  bucket: z.string().optional(),
  key: z.string().optional(),
  fileSize: z.number().nonnegative(),
  width: z.number().optional(),
  height: z.number().optional(),
  uploadedAt: z.iso.datetime().optional(),
  deleteRequestedAt: z.iso.datetime().optional(),
})
export type SecondaryFileInfo = z.infer<typeof secondaryFileInfoSchema>

export const secondaryFileUrlsSchema = z.record(
  contentIdSchemaNarrow,
  z.object({
    url: z.string(),
    expirationDate: z.iso.datetime(),
  })
)
export type SecondaryFileUrls = z.infer<typeof secondaryFileUrlsSchema>

export const secondaryFileUploadDto = z.object({
  parentId: contentIdSchemaNarrow,
  namespace: secondaryFileNamespaceSchema,
  fileId: contentIdSchemaNarrow,
  fileType: z.string(),
  fileEnding: z.string(),
  fileSize: z.number().nonnegative(),
  width: z.number().optional(),
  height: z.number().optional(),
})
export type SecondaryFileUploadDto = z.infer<typeof secondaryFileUploadDto>

export const secondaryFileUploadReturnDto = z.object({
  uploadUrl: z.string(),
  file: secondaryFileInfoSchema,
})
export type SecondaryFileUploadReturnDto = z.infer<typeof secondaryFileUploadReturnDto>

export const secondaryFileUpdateResponseDto = z.object({
  secondaryFileUrls: secondaryFileUrlsSchema,
})
export type SecondaryFileUpdateResponseDto = z.infer<typeof secondaryFileUpdateResponseDto>

export const fileUploadMultipartCacheDto = z.object({
  id: z.uuid(),
  fileEnding: z.string(),
  fileSize: z.number(),
})
export type FileUploadMultipartCacheDto = z.infer<typeof fileUploadMultipartCacheDto>

export const fileUploadMultipartAbortDto = z.object({
  bucket: z.string(),
  key: z.string(),
  uploadId: z.string(),
})
export type FileUploadMultipartAbortDto = z.infer<typeof fileUploadMultipartAbortDto>

export const fileUploadMultipartCompleteDto = z.object({
  bucket: z.string(),
  key: z.string(),
  uploadId: z.string(),
  parts: z.array(
    z.object({
      number: z.number(),
      etag: z.string(),
    })
  ),
})
export type FileUploadMultipartCompleteDto = z.infer<typeof fileUploadMultipartCompleteDto>

export const discountSurveyDto = z.object({
  email: z.string(),
  orgEmail: z.string(),
  role: z.enum(['student', 'teacher', 'ngo', 'other']),
  comment: z.string(),
})
export type DiscountSurveyDto = z.infer<typeof discountSurveyDto>

export const STUDENT_DISCOUNT_PROOF_MAX_FILES = 5
export const STUDENT_DISCOUNT_PROOF_MAX_FILE_BYTES = 8 * 1024 * 1024
export const STUDENT_DISCOUNT_PROOF_MAX_TOTAL_BYTES = 16 * 1024 * 1024
export const STUDENT_DISCOUNT_PROOF_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const
export type StudentDiscountProofContentType = (typeof STUDENT_DISCOUNT_PROOF_CONTENT_TYPES)[number]

export const studentDiscountApplicationFileDto = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.enum(STUDENT_DISCOUNT_PROOF_CONTENT_TYPES),
  data: z.string().min(1),
})
export type StudentDiscountApplicationFileDto = z.infer<typeof studentDiscountApplicationFileDto>

export const studentDiscountApplicationDto = z.object({
  capacitiesEmail: emailSchema,
  educationEmail: z.union([emailSchema, z.literal('')]).optional(),
  institution: z.string().trim().min(2).max(300),
  graduationYear: z.number().int().min(2020).max(2045),
  comment: z.string().max(4000).optional().default(''),
  understoodProcess: z.literal(true),
  dataProcessingConsent: z.literal(true),
  termsAccepted: z.literal(true),
  proofFiles: z.array(studentDiscountApplicationFileDto).min(1).max(STUDENT_DISCOUNT_PROOF_MAX_FILES),
})
export type StudentDiscountApplicationDto = z.infer<typeof studentDiscountApplicationDto>

export const pricingSurveyDto = z.object({
  country: z.string(),
  currency: z.string(),
  believerInterest: z.boolean(),
  believerPrice: z.number(),
  believerComment: z.string(),
  proInterest: z.boolean(),
  proPriceHigh: z.number(),
  proPricePersonal: z.number(),
  proPriceLow: z.number(),
  proComment: z.string(),
  email: z.string(),
})
export type PricingSurveyDto = z.infer<typeof pricingSurveyDto>

export const emailUserUpsertDto = z.object({
  email: emailSchema.optional(),
  /** @deprecated */
  language: languageKeySchema.optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  config: z.object({
    newsletter: z.boolean(),
  }),
})
export type EmailUserUpsertDto = z.infer<typeof emailUserUpsertDto>

export const subscriptionChangePlanDto = z.object({
  planKey: subscriptionPlanKeySchema,
  /** When false, any active Turbo add-on is removed during the plan change. Defaults to true (preserve). */
  preserveTurbo: z.boolean().optional(),
})
export type SubscriptionChangePlanDto = z.infer<typeof subscriptionChangePlanDto>

export const subscriptionCancelDto = z.object({
  cancelReason: z.string().optional(),
  /** @deprecated */
  allowContact: z.boolean().optional(),
})
export type SubscriptionCancelDto = z.infer<typeof subscriptionCancelDto>

export const subscriptionTurboDto = z.object({
  tier: turboTierSchema,
})
export type SubscriptionTurboDto = z.infer<typeof subscriptionTurboDto>

/**
 * Preview of what applying a turbo add-on costs. `immediateAmount` is the
 * net prorated effect charged/credited now; `recurringAmount` is what the whole
 * subscription will cost on the next and subsequent billing cycles.
 */
export type SubscriptionTurboPreviewResponseDto = {
  tier: TurboTier
  period: 'month' | 'year'
  currency: string
  immediateAction: 'charge' | 'credit'
  immediateAmount: number
  recurringAmount: number
  nextBilledAt?: string
}

/**
 * Preview of what a plan change costs. Same shape as SubscriptionTurboPreviewResponseDto
 * but for a full base-plan swap rather than a turbo add-on.
 */
export type SubscriptionPlanChangePreviewResponseDto = {
  planKey: SubscriptionPlanKey
  currency: string
  immediateAction: 'charge' | 'credit'
  /** Amount due now (always 0 when immediateAction is 'credit'). */
  immediateAmount: number
  /** Credit amount added to the customer's Paddle balance (only set when immediateAction is 'credit'). */
  creditAmount?: number
  recurringAmount: number
  nextBilledAt?: string
  creditBalance?: number
}

export const subscriptionFreeTrialEndFeedbackDto = z.object({
  feedback: z.string(),
})
export type SubscriptionFreeTrialEndFeedbackDto = z.infer<typeof subscriptionFreeTrialEndFeedbackDto>

// ---------------------------------------------------------------------------
// AI Top-Up DTOs
// ---------------------------------------------------------------------------

export const aiTopUpPurchaseDto = z.object({
  /** Top-up pack size in USD (must be one of 5, 10, 20, 50). */
  packUsd: z.number().refine((v) => [5, 10, 20, 50].includes(v), { message: 'Invalid pack size' }),
  /** ISO timestamp recording when the user acknowledged the consent message. */
  consentTimestamp: z.string(),
})
export type AITopUpPurchaseDto = z.infer<typeof aiTopUpPurchaseDto>

export type AITopUpPacksResponseDto = {
  packs: Array<{
    planKey: string
    usd: number
    currency: string
    amount: number
  }>
  topUpBalanceUsd: number
  topUpBalanceLocal: number
  topUpLocalCurrency: string
}

export type AITopUpPurchaseResponseDto = {
  transactionId: string
  checkoutUrl: string | undefined
}

// ---------------------------------------------------------------------------
// Support Capacities tip checkout
// ---------------------------------------------------------------------------

export const supportCheckoutDto = z.object({
  amount: z.number().refine((v) => (SUPPORT_AMOUNTS as readonly number[]).includes(v), {
    message: 'Invalid tip amount',
  }),
  email: emailSchema,
  message: z.string().max(2000).optional(),
})
export type SupportCheckoutDto = z.infer<typeof supportCheckoutDto>

export const supportCheckoutCustomDataSchema = z.object({
  capacitiesSupportTipId: z.string(),
})
export type SupportCheckoutCustomData = z.infer<typeof supportCheckoutCustomDataSchema>

export const supportCheckoutResponseDto = z.object({
  priceId: z.string(),
  customer: z.object({ email: emailSchema }),
  customData: supportCheckoutCustomDataSchema,
})
export type SupportCheckoutResponseDto = z.infer<typeof supportCheckoutResponseDto>

// ---------------------------------------------------------------------------
// AI Auto-Recharge DTOs
// ---------------------------------------------------------------------------

export const aiAutoRechargeSettingsDto = z.object({
  enabled: z.boolean(),
  packUsd: z.number().refine((v) => [5, 10, 20, 50].includes(v), { message: 'Invalid pack size' }),
  thresholdUsd: z.number().min(0),
  /** Maximum number of auto-recharges allowed per billing month. */
  monthlyRechargeCap: z.number().int().min(1).max(20),
  /** ISO timestamp recording when the user acknowledged the consent message. */
  consentTimestamp: z.string().optional(),
})
export type AIAutoRechargeSettingsDto = z.infer<typeof aiAutoRechargeSettingsDto>

export const analyticsEventDto = z.object({
  key: z.string(),
  details: z.record(z.string(), z.any().optional()).optional(),
})
export type AnalyticsEventDto = z.infer<typeof analyticsEventDto>

export const analyticsUserDataDto = z.object({
  properties: z.record(z.string(), z.any().optional()),
})
export type AnalyticsUserDataDto = z.infer<typeof analyticsUserDataDto>

const fileLocationSchema = z.object({
  bucket: z.string(),
  key: z.string(),
})
export type FileLocation = z.infer<typeof fileLocationSchema>

const fileResourceUrlsSchema = z.object({
  raw: z.string(),
  full: z.string().optional(),
  regular: z.string().optional(),
  small: z.string().optional(),
  thumb: z.string().optional(),
})
export type FileResourceUrls = z.infer<typeof fileResourceUrlsSchema>

const fileResourceInfoSchema = z.object({
  id: z.uuid(),
  fileType: z.string(),
  locations: z.array(fileLocationSchema),
  urls: fileResourceUrlsSchema.optional(),
  expirationDate: z.iso.datetime().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  blur_hash: z.string().optional(),
})
export type FileResourceInfo = z.infer<typeof fileResourceInfoSchema>
export type FileResourceInfoDb = Omit<FileResourceInfo, 'expirationDate' | 'urls'>

export const fileUploadReturnDto = z.object({
  uploadUrl: z.string(),
  resource: fileResourceInfoSchema,
})
export type FileUploadReturnDto = z.infer<typeof fileUploadReturnDto>

export const fileUploadMultipartReturnDto = z.object({
  uploadUrls: z.array(z.string()),
  uploadId: z.string().optional(),
  bucket: z.string(),
  key: z.string(),
  resource: fileResourceInfoSchema,
})
export type FileUploadMultipartReturnDto = z.infer<typeof fileUploadMultipartReturnDto>

export const updateFileResourceResponseDto = z.object({
  urls: fileResourceUrlsSchema,
  expirationDate: z.iso.datetime(),
  secondaryFileUrls: secondaryFileUrlsSchema.optional(),
})
export type UpdateFileResourceResponseDto = z.infer<typeof updateFileResourceResponseDto>

export const fileUploadCacheReturnDto = z.object({
  key: z.string(),
  uploadUrl: z.string(),
})
export type FileUploadCacheReturnDto = z.infer<typeof fileUploadCacheReturnDto>

export const fileUploadMultipartCacheReturnDto = z.object({
  uploadUrls: z.array(z.string()),
  uploadId: z.string().optional(),
  bucket: z.string(),
  key: z.string(),
})
export type FileUploadMultipartCacheReturnDto = z.infer<typeof fileUploadMultipartCacheReturnDto>

export const bulkImportDto = z.object({
  key: z.string(),
  spaceId: contentIdSchema,
  type: z.enum(['generic', 'obsidian', 'notion']),
  title: z.string(),
  fallbackStructureId: contentIdSchema.optional(),
  topLevelFolderToContentType: z.boolean().optional(),
  folderHandling: z.enum(['tag', 'addToBlocks']).optional(),
  jobLabel: z
    .object({
      type: z.enum(['tag', 'collection', 'addToBlocks']),
      name: z.string().max(200),
    })
    .optional(),
  csvHandling: z.enum(['collection']).optional(),
})
export type BulkImportDto = z.infer<typeof bulkImportDto>

export const weblinkInfoObject = z.object({
  spaceId: contentIdSchemaNarrow,
  id: contentIdSchemaNarrow,
  structureId: structureIdSchema,
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
})
export type WeblinkInfoObject = z.infer<typeof weblinkInfoObject>

export const getObjectFromWeblinkResponseDto = z.object({
  object: weblinkInfoObject.optional(),
})
export type GetObjectFromWeblinkResponseDto = z.infer<typeof getObjectFromWeblinkResponseDto>

export const getObjectFromWeblinkDto = z.object({
  spaceId: contentIdSchemaNarrow,
  url: z.string().url(),
})
export type GetObjectFromWeblinkDto = z.infer<typeof getObjectFromWeblinkDto>

export const utilsExportDto = z.object({
  format: z.enum(['html', 'md', 'docx', 'latex']),
  text: z.string(),
  mediaResources: z.array(
    z.object({
      bucket: z.string(),
      key: z.string(),
      type: z.enum(['internal', 'external']),
      fileLocation: z.string(),
    })
  ),
  fileName: z.string(),
})
export type UtilsExportDto = z.infer<typeof utilsExportDto>

export const utilsExportResponseDto = z.object({
  url: z.string(),
})
export type UtilsExportResponseDto = z.infer<typeof utilsExportResponseDto>

export const utilsImportDto = z.object({
  key: z.string(),
})
export type UtilsImportDto = z.infer<typeof utilsImportDto>

export const utilsImportResponseDto = z.object({
  data: z.string(),
})
export type UtilsImportResponseDto = z.infer<typeof utilsImportResponseDto>

export const pdfExportConfigSchema = z.object({
  language: languageKeySchema,
  hiddenPropertyIds: z.array(z.string()),
  includeEmbedded: z.boolean(),
  includeOutline: z.boolean().optional(),
  showTypeLabels: z.boolean().optional(),
  hideEmptyProperties: z.boolean().optional(),
  userPersonalId: contentIdSchemaExtended.optional(),
})
export type PDFExportConfig = z.infer<typeof pdfExportConfigSchema>

export const utilsExportPdfDto = z.object({
  id: contentIdSchema,
  format: z.enum(['a4', 'letter']).optional(),
  fileName: z.string(),
  config: pdfExportConfigSchema,
})
export type UtilsExportPdfDto = z.infer<typeof utilsExportPdfDto>

export const utilsExportPdfResponseDto = z.object({
  url: z.string(),
})
export type UtilsExportPdfResponseDto = z.infer<typeof utilsExportPdfResponseDto>

export const typesetPdfModeSchema = z.enum(['essay', 'academic'])
export type TypesetPdfMode = z.infer<typeof typesetPdfModeSchema>

export const typesetPdfExportConfigSchema = pdfExportConfigSchema.omit({ includeEmbedded: true }).extend({
  mode: typesetPdfModeSchema,
})
export type TypesetPdfExportConfig = z.infer<typeof typesetPdfExportConfigSchema>

export const utilsExportTypesetPdfDto = z.object({
  id: contentIdSchema,
  format: z.enum(['a4', 'letter']).optional(),
  fileName: z.string(),
  config: typesetPdfExportConfigSchema,
})
export type UtilsExportTypesetPdfDto = z.infer<typeof utilsExportTypesetPdfDto>

export const utilsExportTypesetPdfResponseDto = z.object({
  url: z.string(),
})
export type UtilsExportTypesetPdfResponseDto = z.infer<typeof utilsExportTypesetPdfResponseDto>

export const readwiseSyncDto = z.object({
  userIdentity: z.string(),
})
export type ReadwiseSyncDto = z.infer<typeof readwiseSyncDto>

export const readwiseObjectDto = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string().nullable(),
  source: z.string(),
  category: z.enum(READWISE_CONTENT_TYPES),
  tags: z.array(z.string()),
  summary: z.string().nullable(),
  note: z.string().optional(),
  imageUrl: z.string().nullable(),
  readwiseUrl: z.string(),
  sourceUrl: z.string().nullable(),
})
export type ReadwiseObjectDto = z.infer<typeof readwiseObjectDto>

export const readwiseObjectsGetDto = z.object({
  lastUpdated: z.iso.datetime().optional(),
})
export type ReadwiseObjectsGetDto = z.infer<typeof readwiseObjectsGetDto>

export const readwiseObjectsGetResponseDto = z.object({
  lastUpdated: z.iso.datetime(),
  objects: z.array(readwiseObjectDto),
})
export type ReadwiseObjectsGetResponseDto = z.infer<typeof readwiseObjectsGetResponseDto>

export const readwiseObjectsPaginatedGetDto = z.object({
  spaceId: z.string(),
  cursor: z.union([z.string(), z.number()]).optional(),
})
export type ReadwiseObjectsPaginatedGetDto = z.infer<typeof readwiseObjectsPaginatedGetDto>

export const readwiseObjectsPaginatedGetResponseDto = z.object({
  objects: z.array(readwiseObjectDto),
  cursor: z.string().optional(),
  lastUpdated: z.iso.datetime(),
})
export type ReadwiseObjectsPaginatedGetResponseDto = z.infer<typeof readwiseObjectsPaginatedGetResponseDto>

export const readwiseObjectImportDto = z.object({
  spaceId: contentIdSchema,
  objectId: z.string(),
})
export type ReadwiseObjectImportDto = z.infer<typeof readwiseObjectImportDto>

export const readwiseObjectImportResponseDto = z.object({
  spaceId: contentIdSchema,
  id: contentIdSchema,
  components: z.array(componentDto).optional(), // if it's an existing object, do not return components
})
export type ReadwiseObjectImportResponseDto = z.infer<typeof readwiseObjectImportResponseDto>
