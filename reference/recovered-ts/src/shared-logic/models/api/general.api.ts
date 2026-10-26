import { z } from 'zod'
import { cTypes } from '../component.model.js'
import { WELCOME_SPACE_TEMPLATE_ID, WELCOME_SPACE_TEMPLATE_ID_LEGACY } from '../RootSpace.model.js'
import { isValidHttpUrl } from '../../util/general.js'

export const contentIdSchemaNarrow = z.uuid()
export const linkIdSchema = z.uuid()
export const structureIdSchema = z.union([contentIdSchemaNarrow, z.enum(cTypes)])
export const contentIdSchema = z.union([
  structureIdSchema,
  z.literal(WELCOME_SPACE_TEMPLATE_ID),
  z.literal(WELCOME_SPACE_TEMPLATE_ID_LEGACY),
])
export const contentIdSchemaExtended = z.union([contentIdSchema, z.literal('local_userPersonal_id')])
export const urlSchema = z.string().refine((url) => !!isValidHttpUrl(url, true), 'invalid url')
