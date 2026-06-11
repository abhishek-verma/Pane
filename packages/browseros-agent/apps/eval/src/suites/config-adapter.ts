import { basename, resolve } from 'node:path'
import { type EvalConfig, EvalConfigSchema } from '../types'
import { type EvalVariant, resolveVariant } from './resolve-variant'
import type { EvalSuite } from './schema'

export type Env = Record<string, string | undefined>

export interface AdaptEvalConfigOptions {
  env?: Env
}

export interface AdaptedEvalConfig {
  configPath: string
  evalConfig: EvalConfig
  suite: EvalSuite
  variant: EvalVariant
}

function executorBackend(
  config: EvalConfig,
): 'tool-loop' | 'clado' | undefined {
  if (config.agent.type !== 'orchestrator-executor') return undefined
  return config.agent.executor.provider === 'clado-action'
    ? 'clado'
    : 'tool-loop'
}

function variantSource(config: EvalConfig): {
  provider: string
  model: string
  apiKey?: string
  apiKeyEnv?: string
  baseUrl?: string
  supportsImages?: boolean
} {
  if (config.agent.type === 'claude-code') {
    return {
      provider: 'claude-code',
      model: config.agent.model ?? 'default',
    }
  }

  const agent =
    config.agent.type === 'single' ? config.agent : config.agent.orchestrator
  if (!agent.model) {
    throw new Error('Config agent model is required')
  }
  const apiKeyEnv = /^[A-Z][A-Z0-9_]*$/.test(agent.apiKey ?? '')
    ? agent.apiKey
    : undefined

  return {
    provider: agent.provider,
    model: agent.model,
    apiKey: agent.apiKey,
    apiKeyEnv,
    baseUrl: agent.baseUrl,
    supportsImages:
      config.agent.type === 'single' ? config.agent.supportsImages : undefined,
  }
}

/** Adapts an existing eval config into the suite/variant model. */
export async function adaptEvalConfigFile(
  configPath: string,
  options: AdaptEvalConfigOptions = {},
): Promise<AdaptedEvalConfig> {
  const absolute = resolve(configPath)
  const raw = JSON.parse(await Bun.file(absolute).text())
  const evalConfig = EvalConfigSchema.parse(raw)
  const id = basename(absolute, '.json')
  const backend = executorBackend(evalConfig)
  const source = variantSource(evalConfig)
  const env = options.env ?? process.env
  const apiKey =
    source.apiKeyEnv && env[source.apiKeyEnv]
      ? env[source.apiKeyEnv]
      : source.apiKey

  return {
    configPath: absolute,
    evalConfig,
    suite: {
      id,
      dataset: evalConfig.dataset,
      agent: suiteAgent(evalConfig, backend),
      graders: evalConfig.graders ?? [],
      workers: evalConfig.num_workers,
      restartBrowserPerTask: evalConfig.restart_server_per_task,
      timeoutMs: evalConfig.timeout_ms,
      browseros: evalConfig.browseros,
      captcha: evalConfig.captcha,
    },
    variant: resolveVariant({
      variantId: id,
      provider: source.provider,
      model: source.model,
      apiKey,
      apiKeyEnv: source.apiKeyEnv,
      baseUrl: source.baseUrl,
      supportsImages: source.supportsImages,
      env,
    }),
  }
}

function suiteAgent(
  config: EvalConfig,
  backend: ReturnType<typeof executorBackend>,
): EvalSuite['agent'] {
  switch (config.agent.type) {
    case 'single':
      return { type: 'tool-loop' }
    case 'orchestrator-executor':
      return { type: 'orchestrated', executorBackend: backend ?? 'tool-loop' }
    case 'claude-code':
      return { type: 'claude-code' }
  }
}
