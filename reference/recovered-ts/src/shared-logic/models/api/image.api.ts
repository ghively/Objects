import { z } from 'zod'
import { contentIdSchema } from './general.api.js'
import { IMAGE_CATEGORY_KEYS } from '../../util/basicStructures.js'

// Fields that can be requested
export const imageAnalysisFieldSchema = z.enum(['ocr', 'title', 'shortDescription', 'category', 'colors'])
export type ImageAnalysisField = z.infer<typeof imageAnalysisFieldSchema>

// Bounding box for OCR text blocks
export const boundingBoxSchema = z.object({
  x: z.number().min(0).max(1), // Normalized 0-1
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
})
export type BoundingBox = z.infer<typeof boundingBoxSchema>

// OCR text block with position
export const ocrBlockSchema = z.object({
  text: z.string(),
  boundingBox: boundingBoxSchema,
  confidence: z.number().min(0).max(1),
})
export type OcrBlock = z.infer<typeof ocrBlockSchema>

// Full OCR result
export const ocrResultSchema = z.object({
  fullText: z.string(), // Markdown formatted
  hasText: z.boolean(),
  blocks: z.array(ocrBlockSchema),
})
export type OcrResult = z.infer<typeof ocrResultSchema>

// Category result with confidence
export const categoryResultSchema = z.object({
  primary: z.enum(IMAGE_CATEGORY_KEYS),
  confidence: z.number().min(0).max(1),
})
export type CategoryResult = z.infer<typeof categoryResultSchema>

export const titleReplacementDecisionSchema = z.object({
  shouldReplace: z.boolean(),
  confidence: z.number().min(0).max(1),
})
export type TitleReplacementDecision = z.infer<typeof titleReplacementDecisionSchema>

// Color with metadata
export const colorInfoSchema = z.object({
  hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  name: z.string(),
  category: z.string(),
})
export type ColorInfo = z.infer<typeof colorInfoSchema>

// Request DTO
export const imageAnalysisRequestDto = z.object({
  id: contentIdSchema,
  delay: z.number().optional(),
})
export type ImageAnalysisRequestDto = z.infer<typeof imageAnalysisRequestDto>

// Response DTO
export const imageAnalysisResponseDto = z.object({
  ocr: ocrResultSchema.optional(),
  title: z.string().optional(),
  titleShouldBeReplaced: titleReplacementDecisionSchema.optional(),
  shortDescription: z.string().optional(),
  category: categoryResultSchema.optional(),
  colors: z.array(colorInfoSchema).optional(),
})
export type ImageAnalysisResponseDto = z.infer<typeof imageAnalysisResponseDto>
