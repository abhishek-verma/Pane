import {
  type InstalledLayer,
  installedLayerSchema,
} from '@browseros/shared/layers/manifest'
import { z } from 'zod'

const layerSchema = z.unknown().transform((value, ctx): InstalledLayer => {
  const result = installedLayerSchema.safeParse(value)
  if (!result.success) {
    ctx.addIssue({ code: 'custom', message: 'Invalid installed Layer.' })
    return z.NEVER
  }
  return result.data
})

export const LAYER_CHANNEL = 'pane.layers.v1'
export const documentHelloSchema = z
  .object({
    channel: z.literal(LAYER_CHANNEL),
    kind: z.literal('hello'),
    instanceId: z.string().uuid(),
    routeEpoch: z.number().int().nonnegative(),
    url: z.string().url().max(8192),
    title: z.string().max(300),
  })
  .strict()
export const pageCommandSchema = z
  .object({
    channel: z.literal(LAYER_CHANNEL),
    kind: z.literal('command'),
    instanceId: z.string().uuid(),
    routeEpoch: z.number().int().nonnegative(),
    command: z.enum([
      'inspect',
      'preview',
      'verify',
      'verify-reload',
      'script-check',
      'clear',
    ]),
    layer: layerSchema.optional(),
    execution: z.unknown().optional(),
  })
  .strict()
export const pageUpdateSchema = z
  .object({
    channel: z.literal(LAYER_CHANNEL),
    kind: z.literal('update'),
    instanceId: z.string().uuid(),
    routeEpoch: z.number().int().nonnegative(),
    layers: z.array(layerSchema).max(1000),
    paused: z.boolean().default(false),
    disabledIds: z.array(z.string()).max(1000).default([]),
  })
  .strict()
