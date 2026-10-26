import { z } from 'zod'
import { isValidEmail } from '../../util/general.js'
import { contentIdSchemaExtended, contentIdSchemaNarrow } from './general.api.js'
import { subscriptionPlanKeySchema, userRoleSchema } from '../access.model.js'
import { versionStatePlatformSchema } from '../general.model.js'
import { componentDto } from './content.api.js'
import type { ComponentFull } from '../component.model.js'

const PASSWORD_MIN_LENGTH = 8 // this should match the minimum length with the 'check-password-strength' library
const PASSWORD_MAX_LENGTH = 100

export const OTP_OPTIONS_MAX = 5

export const emailSchema = z.string().refine((email) => isValidEmail(email), 'invalid email')
const passwordValidationSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH)
const passwordValidationSchemaLegacy = z.string().min(6).max(PASSWORD_MAX_LENGTH)

export function isValidPasswordBackend(password: string) {
  return password.length >= PASSWORD_MIN_LENGTH && password.length < PASSWORD_MAX_LENGTH
}

export const API_SCOPES = ['api:read', 'api:write'] as const
export type ApiScope = (typeof API_SCOPES)[number]
export const apiScopeSchema = z.enum(API_SCOPES)

// USER IDENTITY FRONTEND
const userIdentityFrontendSchema = z.object({
  id: contentIdSchemaExtended,
  email: emailSchema,
  roles: z.array(userRoleSchema),
  emailNotVerified: z.boolean().optional(),
  isCapacitiesTeam: z.boolean().optional(),
  adminLevel: z.enum(['full', 'support']).optional(),
  entitlements: z.string(),
})
export type UserIdentityFrontend = z.infer<typeof userIdentityFrontendSchema>

const roleDtoSchema = z.object({
  name: z.string(),
  config: z.any().optional(),
})

export const userIdentityFrontendDto = userIdentityFrontendSchema.omit({ roles: true }).extend({
  roles: z.array(roleDtoSchema),
})

// USER SCHEMAS
export const affiliateInfoSchema = z.object({
  type: z.enum(['rewardful']),
  id: z.uuid(),
  name: z.string().optional(),
})
export type AffiliateInfo = z.infer<typeof affiliateInfoSchema>

export const attributionTouchSchema = z.object({
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
  utmContent: z.string().optional(),
  utmTerm: z.string().optional(),
  gclid: z.string().optional(),
  fbclid: z.string().optional(),
  msclkid: z.string().optional(),
  via: z.string().optional(),
  landingPath: z.string().optional(),
  capturedAt: z.iso.datetime().optional(),
})
export type AttributionTouch = z.infer<typeof attributionTouchSchema>

export const registrationMetadataSchema = attributionTouchSchema.extend({
  firstTouch: attributionTouchSchema.optional(),
  lastTouch: attributionTouchSchema.optional(),
})
export type RegistrationMetadata = z.infer<typeof registrationMetadataSchema>

function parseOptionalAffiliateInfo(value: unknown): AffiliateInfo | undefined {
  if (value == null) return undefined
  const parsed = affiliateInfoSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export const userCreateDto = z.object({
  email: emailSchema,
  password: passwordValidationSchema,
  language: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  spaceId: z.string().optional(),
  affiliateInfo: z.preprocess(parseOptionalAffiliateInfo, affiliateInfoSchema.optional()),
  metadata: registrationMetadataSchema.optional(),
  cfToken: z.string().optional(),
})
export type UserCreateDto = z.infer<typeof userCreateDto>

export const userLoginDto = z.object({
  email: emailSchema,
  password: passwordValidationSchemaLegacy,
  otp: z
    .object({
      id: z.union([z.enum(['backupCodes']), z.uuid()]),
      token: z.string(),
    })
    .optional(),
  cfToken: z.string().optional(),
})
export type UserLoginDto = z.infer<typeof userLoginDto>

export const userVerifyEmailDto = z.object({
  key: z.string(),
  variant: z.enum(['integration']).optional(),
})
export type UserVerifyEmailDto = z.infer<typeof userVerifyEmailDto>

export type UserVerifyEmailExtendedDto = UserVerifyEmailDto & { email?: string | undefined }

export const userEmailDto = z.object({
  email: emailSchema,
})
export type UserEmailDto = z.infer<typeof userEmailDto>
export const userUpdateEmailDto = z.object({
  email: emailSchema,
  password: z.string(),
})
export type UserUpdateEmailDto = z.infer<typeof userUpdateEmailDto>

export const userNewsletterDto = z.object({
  email: emailSchema,
})
export type UserNewsletterDto = z.infer<typeof userNewsletterDto>

export const userUpdateEmailVerifyDto = z.object({
  email: emailSchema,
  key: z.string(),
  newEmail: emailSchema,
})
export type UserUpdateEmailVerifyDto = z.infer<typeof userUpdateEmailVerifyDto>

export const userUpdatePasswordDto = z.object({
  oldPassword: z.string(),
  newPassword: passwordValidationSchema,
  logoutFromAllDevices: z.boolean(),
})
export type UserUpdatePasswordDto = z.infer<typeof userUpdatePasswordDto>

export const userResetPasswordConfirmDto = z.object({
  key: z.string(),
  password: passwordValidationSchema,
})
export type UserResetPasswordConfirmDto = z.infer<typeof userResetPasswordConfirmDto>

export const userDeleteAccountDto = z.object({
  password: z.string(),
})
export type UserDeleteAccountDto = z.infer<typeof userDeleteAccountDto>

export const userLogoutFromSessionsDto = z.object({
  ids: z.array(z.string()),
})
export type UserLogoutFromSessionsDto = z.infer<typeof userLogoutFromSessionsDto>

export const userUpdateRoleDto = z.object({
  /** @deprecated */
  userId: contentIdSchemaNarrow.optional(),
  operation: z.enum(['add', 'remove']),
  role: userRoleSchema,
})
export type UserUpdateRoleDto = z.infer<typeof userUpdateRoleDto>

export const userOTPLoginOptionsDto = z.array(
  z.object({ id: z.uuid(), type: z.enum(['totp']), title: z.string().optional() })
)
export type UserOTPLoginOptionsDto = z.infer<typeof userOTPLoginOptionsDto>

export const userOTPInfoDto = z.object({
  backupCodes: z.object({
    createdAt: z.iso.datetime(),
    codes: z.array(z.string()),
  }),
  options: z.array(
    z.object({
      id: z.uuid(),
      type: z.enum(['totp']),
      title: z.string().optional(),
      secret: z.string(),
      setupUrl: z.string().optional(),
    })
  ),
})
export type UserOTPInfoDto = z.infer<typeof userOTPInfoDto>

export const userOTPSetupDto = z.object({
  password: z.string(),
})
export type UserOTPSetupDto = z.infer<typeof userOTPSetupDto>

export const userOTPAddOptionDto = z.object({
  type: z.enum(['totp']),
})
export type UserOTPAddOptionDto = z.infer<typeof userOTPAddOptionDto>

export const userOTPDeleteDto = z.object({
  password: z.string(),
  id: z.uuid().optional(),
})
export type UserOTPDeleteDto = z.infer<typeof userOTPDeleteDto>

export const userOTPVerifyOptionDto = z.object({
  id: z.uuid(),
  token: z.string(),
  title: z.string().optional(),
})
export type UserOTPVerifyOptionDto = z.infer<typeof userOTPVerifyOptionDto>

// auth profile
const loginSessionDto = z.object({
  id: z.string(),
  isActiveSession: z.boolean(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  platform: versionStatePlatformSchema.optional(),
})
export type LoginSessionDto = z.infer<typeof loginSessionDto>

export const StudentDiscount = z.object({
  expiresAt: z.iso.datetime(),
  discountPercentage: z.number(),
  eligiblePlans: z.array(subscriptionPlanKeySchema),
})
export type StudentDiscount = z.infer<typeof StudentDiscount>

const mediaUsageDataDto = z.object({
  total: z.number(),
  lastMonth: z.object({
    date: z.string(),
    total: z.number(),
  }),
  f1: z.number(), // limit total
  f2: z.number(), // limit monthly
  f3: z.number(), // limit total free plan
  f4: z.number(), // limit monthly free plan
  spaces: z.record(
    z.string(),
    z
      .object({
        total: z.number(),
        lastMonth: z.object({
          date: z.string(),
          total: z.number(),
        }),
      })
      .optional()
  ),
})
export type MediaUsageDataDto = z.infer<typeof mediaUsageDataDto>

export const userAuthProfileDto = z.object({
  otp: userOTPInfoDto.optional(),
  loginSessions: z.array(loginSessionDto),
  twitter: z
    .object({
      profiles: z.array(
        z.object({
          id: z.string(),
          username: z.string(),
        })
      ),
    })
    .optional(),
  telegram: z
    .object({
      chats: z.array(
        z.object({
          chatId: z.string(),
          telegramUserId: z.string(),
        })
      ),
    })
    .optional(),
  whatsapp: z
    .object({
      chats: z.array(
        z.object({
          whatsappId: z.string(),
          bsuid: z.string().optional(), // Business-Scoped User ID for username adopters
        })
      ),
    })
    .optional(),
  email: z
    .object({
      emails: z.array(
        z.union([
          z.object({ email: z.string(), status: z.enum(['verified']) }),
          z.object({
            email: z.string(),
            status: z.enum(['pending']),
            emailVerificationString: z.string(),
          }),
        ])
      ),
    })
    .optional(),
  publicApi: z
    .object({
      tokens: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            lastFourDigits: z.string(),
            createdAt: z.iso.datetime(),
          })
        )
        .optional(),
      apiTokens: z
        .array(
          z.object({
            id: z.string(),
            prefix: z.string(),
            name: z.string(),
            spaceId: z.string(),
            scopes: z.array(apiScopeSchema),
            createdAt: z.iso.datetime(),
            lastUsed: z.object({ date: z.iso.datetime(), version: z.string() }).optional(),
          })
        )
        .optional(),
    })
    .optional(),
  oauth: z
    .object({
      tokens: z.array(
        z.object({
          id: z.string(),
          spaceId: z.string(),
          origin: z.enum(['mcp', 'api']),
          service: z.string(),
          scopes: z.array(z.string()).optional(),
          serviceInfo: z
            .object({
              name: z.string(),
              iconUrl: z.string().optional(),
              description: z.string().optional(),
              url: z.string().optional(),
            })
            .optional(),
          createdAt: z.string(),
        })
      ),
    })
    .optional(),
  readers: z
    .object({
      integrations: z
        .array(
          z.object({
            id: z.string(),
            service: z.enum(['readwise']),
            createdAt: z.iso.datetime(),
            status: z.enum(['active', 'inactive']),
            errorMessage: z.string().optional(),
          })
        )
        .optional(),
    })
    .optional(),
  studentDiscountState: StudentDiscount.optional(),
  mediaUsage: mediaUsageDataDto.optional(),
  /** Projected without `pushToken`, which is server-only. `hasPushToken` is derived for mobile UI. */
  notificationDevices: z
    .record(
      z.string(),
      z.object({
        platform: versionStatePlatformSchema,
        label: z.string().optional(),
        spaceIds: z.array(z.string()).optional(),
        lastSeenAt: z.string(),
        hasPushToken: z.boolean().optional(),
      })
    )
    .optional(),
})
export type UserAuthProfileDto = z.infer<typeof userAuthProfileDto>
export type NotificationDeviceProfileRecord = NonNullable<UserAuthProfileDto['notificationDevices']>[string]

// USER UPDATE
const userLoginResponseSuccessDto = z.object({
  user: userIdentityFrontendDto,
})
export type UserLoginResponseSuccessDto = z.infer<typeof userLoginResponseSuccessDto>

export const userLoginResponseDto = z.union([
  userLoginResponseSuccessDto,
  z.object({ otpOptions: userOTPLoginOptionsDto }),
])
export type UserLoginResponseDto = z.infer<typeof userLoginResponseDto>

export const userCreateResponseDto = z.object({
  user: userIdentityFrontendDto,
  emailNotVerified: z.boolean(),
  userPersonalId: z.string(),
  components: z.array(componentDto),
})
export type UserCreateResponseDto = z.infer<typeof userCreateResponseDto>
export type UserCreateResponse = Omit<UserCreateResponseDto, 'components'> & { components: ComponentFull[] }

export const userUpdateRoleResponseDto = z.object({
  roles: z.array(roleDtoSchema).optional(),
  entitlements: z.string(),
})
export type UserUpdateRoleResponseDto = z.infer<typeof userUpdateRoleResponseDto>

// Public API Auth
export const publicApiGenerateTokenDto = z.object({
  name: z.string().min(3).max(100),
})
export type PublicApiGenerateTokenDto = z.infer<typeof publicApiGenerateTokenDto>

export const publicApiGenerateTokenResponseDto = z.object({
  id: z.uuid(),
  token: z.string(),
  authProfile: userAuthProfileDto,
})
export type PublicApiGenerateTokenResponseDto = z.infer<typeof publicApiGenerateTokenResponseDto>

export const publicApiDeleteTokenDto = z.object({
  id: z.uuid(),
})
export type PublicApiDeleteTokenDto = z.infer<typeof publicApiDeleteTokenDto>

export const publicApiGetTokenDto = z.object({
  id: z.uuid(),
})
export type PublicApiGetTokenDto = z.infer<typeof publicApiGetTokenDto>

export const publicApiGetTokenResponseDto = z.object({
  token: z.string().optional(),
})
export type PublicApiGetTokenResponseDto = z.infer<typeof publicApiGetTokenResponseDto>

// NOTIFICATION DEVICES — registration = active; delete to turn off (no inactive state).
export const NOTIFICATION_DEVICE_MAX_COUNT = 20
const unsafeNotificationDeviceIds = new Set(['__proto__', 'prototype', 'constructor'])
const notificationDeviceIdDto = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (deviceId) =>
      !unsafeNotificationDeviceIds.has(deviceId) && !Object.prototype.hasOwnProperty.call(Object.prototype, deviceId),
    {
      message: 'Invalid device id',
    }
  )
const notificationDeviceLabelDto = z.string().max(100)
const notificationPushTokenDto = z.string().max(4096)
const notificationSpaceIdsDto = z.array(z.string().min(1).max(128)).max(100)

export const notificationDeviceRegisterDto = z.object({
  deviceId: notificationDeviceIdDto,
  platform: versionStatePlatformSchema,
  label: notificationDeviceLabelDto.optional(),
  pushToken: notificationPushTokenDto.optional(),
  pushEnvironment: z.enum(['production', 'sandbox']).optional(),
})
export type NotificationDeviceRegisterDto = z.infer<typeof notificationDeviceRegisterDto>

export const notificationDeviceUpdateDto = z.object({
  deviceId: notificationDeviceIdDto,
  label: notificationDeviceLabelDto.optional(),
  spaceIds: notificationSpaceIdsDto.optional(),
  pushToken: notificationPushTokenDto.nullable().optional(),
  pushEnvironment: z.enum(['production', 'sandbox']).nullable().optional(),
})
export type NotificationDeviceUpdateDto = z.infer<typeof notificationDeviceUpdateDto>

export const notificationDeviceDeleteDto = z.object({
  deviceId: notificationDeviceIdDto,
})
export type NotificationDeviceDeleteDto = z.infer<typeof notificationDeviceDeleteDto>

export const notificationDeviceTestPushDto = z.object({
  deviceId: notificationDeviceIdDto,
})
export type NotificationDeviceTestPushDto = z.infer<typeof notificationDeviceTestPushDto>

// API Token management
export const API_TOKEN_NAME_MAX_LENGTH = 100
export const API_TOKEN_NAME_MIN_LENGTH = 1

export const apiTokenCreateDto = z.object({
  name: z.string().min(API_TOKEN_NAME_MIN_LENGTH).max(API_TOKEN_NAME_MAX_LENGTH),
  spaceId: z.string(),
  scopes: z.array(apiScopeSchema).min(1),
})
export type ApiTokenCreateDto = z.infer<typeof apiTokenCreateDto>

export const apiTokenCreateResponseDto = z.object({
  id: z.uuid(),
  token: z.string(),
  authProfile: userAuthProfileDto,
})
export type ApiTokenCreateResponseDto = z.infer<typeof apiTokenCreateResponseDto>

export const apiTokenUpdateDto = z.object({
  id: z.uuid(),
  name: z.string().min(API_TOKEN_NAME_MIN_LENGTH).max(API_TOKEN_NAME_MAX_LENGTH).optional(),
  spaceId: z.string().optional(),
  scopes: z.array(apiScopeSchema).min(1).optional(),
})
export type ApiTokenUpdateDto = z.infer<typeof apiTokenUpdateDto>

export const apiTokenDeleteDto = z.object({
  id: z.uuid(),
})
export type ApiTokenDeleteDto = z.infer<typeof apiTokenDeleteDto>
