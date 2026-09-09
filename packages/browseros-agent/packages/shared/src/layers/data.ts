import { z } from 'zod'

export const DATA_OPERATIONS = {
  'github.repository.stats': {
    name: 'Public GitHub repository counts',
    destination: 'https://api.github.com',
    disclosure:
      'Sends public repository owner/name identifiers to api.github.com. No account credentials are used.',
    fields: ['stars', 'forks'] as const,
  },
} as const
export const dataOperationIdSchema = z.literal('github.repository.stats')
export const repositoryEntitySchema = z
  .string()
  .max(140)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/)
  .refine(
    (value) => !['.', '..'].includes(value.split('/')[1] ?? ''),
    'Invalid repository name.',
  )
export const dataInputSchema = z
  .object({
    schema: z.literal('pane.data-input.v1'),
    operationId: dataOperationIdSchema,
    entities: z.array(repositoryEntitySchema).min(1).max(64),
  })
  .strict()
export type DataInput = z.infer<typeof dataInputSchema>
export const dataEntrySchema = z
  .object({
    entityId: repositoryEntitySchema,
    state: z.enum(['fresh', 'stale', 'unavailable', 'rate-limited', 'denied']),
    values: z
      .object({
        stars: z.number().int().nonnegative(),
        forks: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    fetchedAt: z.number().int().nonnegative().optional(),
    expiresAt: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!['fresh', 'stale'].includes(value.state) && value.values)
      ctx.addIssue({
        code: 'custom',
        message: 'Unavailable data cannot contain values.',
      })
    if (
      value.fetchedAt !== undefined &&
      value.expiresAt !== undefined &&
      value.expiresAt < value.fetchedAt
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Data expiry cannot precede its fetch time.',
      })
    if (
      ['fresh', 'stale'].includes(value.state) &&
      (!value.values ||
        value.fetchedAt === undefined ||
        value.expiresAt === undefined)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Available data requires values and freshness metadata.',
      })
  })
export const dataResultSchema = z
  .object({
    schema: z.literal('pane.data.v1'),
    operationId: dataOperationIdSchema,
    entries: z.array(dataEntrySchema).min(1).max(64),
  })
  .strict()
export type DataResult = z.infer<typeof dataResultSchema>
export type DataEntry = z.infer<typeof dataEntrySchema>
export function repositoryEntityFromHref(href: string): string | undefined {
  try {
    const url = new URL(href)
    if (
      url.origin !== 'https://github.com' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return undefined
    const parsed = repositoryEntitySchema.safeParse(
      url.pathname.replace(/^\//, '').replace(/\/$/, ''),
    )
    return parsed.success ? parsed.data.toLowerCase() : undefined
  } catch {
    return undefined
  }
}
