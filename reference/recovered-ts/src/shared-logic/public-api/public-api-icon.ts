import { z } from 'zod'

export const apiIconSchema = z
  .object({
    type: z
      .enum(['emoji', 'iconify'])
      .describe(
        'Icon variant — `emoji` for an emoji character, `iconify` for a regular Phosphor icon ID. See https://phosphoricons.com/.'
      ),
    val: z
      .string()
      .describe(
        'The icon value. For `emoji`, use a single emoji. For `iconify`, use regular Phosphor `ph-name` syntax only, for example `ph-star`; styled variants such as `-duotone`, `-fill`, `-bold`, `-light`, and `-thin` are not accepted.'
      ),
  })
  .meta({
    id: 'ApiIcon',
    description: 'Object or space icon value.',
  })

export type ApiIcon = z.infer<typeof apiIconSchema>
