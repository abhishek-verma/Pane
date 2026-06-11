import type { RunEvalOptions, RunEvalResult } from '../../runner/types'
import { runEval as defaultRunEval } from '../../runs/eval-runner'
import {
  type AdaptedEvalConfig,
  adaptEvalConfigFile,
} from '../../suites/config-adapter'
import { loadSuite } from '../../suites/load-suite'
import { type EvalVariant, resolveVariant } from '../../suites/resolve-variant'
import type { EvalSuite } from '../../suites/schema'
import { type EvalConfig, EvalConfigSchema } from '../../types'
import type { PublishTarget } from '../args'

export type Env = Record<string, string | undefined>

export interface SuiteCommandOptions {
  configPath?: string
  suitePath?: string
  variantId?: string
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string
  publishTarget?: PublishTarget
  env?: Env
}

export type ResolvedSuiteCommand =
  | (AdaptedEvalConfig & { kind: 'config'; datasetPath?: undefined })
  | {
      kind: 'suite'
      suitePath: string
      suite: EvalSuite
      variant: EvalVariant
      datasetPath: string
      evalConfig: EvalConfig
    }

export interface SuiteCommandDeps {
  runEval?: (options: RunEvalOptions) => Promise<RunEvalResult | undefined>
  publishRun?: (options: {
    runDir: string
    target: PublishTarget
  }) => Promise<void>
}

function ensureRunnableSuite(suite: EvalSuite): void {
  if (!suite.browseros) {
    throw new Error('suite browseros config is required to run suite commands')
  }
}

function suiteToEvalConfig(
  suite: EvalSuite,
  datasetPath: string,
  variant: EvalVariant,
  env: Env,
): EvalConfig {
  ensureRunnableSuite(suite)

  const base = {
    dataset: datasetPath,
    num_workers: suite.workers,
    restart_server_per_task: suite.restartBrowserPerTask,
    browseros: suite.browseros,
    graders: suite.graders,
    timeout_ms: suite.timeoutMs,
    captcha: suite.captcha,
  }

  if (suite.agent.type === 'single' || suite.agent.type === 'tool-loop') {
    // The legacy runner names the BrowserOS tool-loop agent "single".
    return EvalConfigSchema.parse({
      ...base,
      agent: {
        type: 'single',
        provider: variant.agent.provider,
        model: variant.agent.model,
        apiKey: variant.agent.apiKey,
        baseUrl: variant.agent.baseUrl,
        supportsImages: variant.agent.supportsImages,
      },
    })
  }

  if (suite.agent.type === 'claude-code') {
    return EvalConfigSchema.parse({
      ...base,
      agent: {
        type: 'claude-code',
        ...(variant.agent.model && { model: variant.agent.model }),
      },
    })
  }

  const executorBackend = suite.agent.executorBackend ?? 'tool-loop'
  const executor =
    executorBackend === 'clado'
      ? {
          provider: 'clado-action' as const,
          model:
            env.EVAL_EXECUTOR_MODEL ?? env.CLADO_ACTION_MODEL ?? 'clado-action',
          apiKey: env.EVAL_EXECUTOR_API_KEY ?? env.CLADO_ACTION_API_KEY ?? '',
          baseUrl:
            env.EVAL_EXECUTOR_BASE_URL ??
            env.CLADO_ACTION_BASE_URL ??
            env.CLADO_ACTION_URL,
        }
      : {
          provider: variant.agent.provider,
          model: variant.agent.model,
          apiKey: variant.agent.apiKey,
          baseUrl: variant.agent.baseUrl,
        }

  return EvalConfigSchema.parse({
    ...base,
    agent: {
      type: 'orchestrator-executor',
      orchestrator: {
        provider: variant.agent.provider,
        model: variant.agent.model,
        apiKey: variant.agent.apiKey,
        baseUrl: variant.agent.baseUrl,
      },
      executor,
    },
  })
}

/** Resolves config-backed or suite-backed CLI input into the run shape used by the runner. */
export async function resolveSuiteCommand(
  options: SuiteCommandOptions,
): Promise<ResolvedSuiteCommand> {
  const env = options.env ?? process.env
  if (options.configPath) {
    return {
      kind: 'config',
      ...(await adaptEvalConfigFile(options.configPath, { env })),
    }
  }
  if (!options.suitePath) {
    throw new Error('suite requires --config or --suite')
  }

  const loaded = await loadSuite(options.suitePath)
  const variant = resolveVariant({
    variantId: options.variantId,
    provider:
      loaded.suite.agent.type === 'claude-code'
        ? 'claude-code'
        : options.provider,
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    env,
  })

  return {
    kind: 'suite',
    suitePath: loaded.suitePath,
    suite: loaded.suite,
    variant,
    datasetPath: loaded.datasetPath,
    evalConfig: suiteToEvalConfig(
      loaded.suite,
      loaded.datasetPath,
      variant,
      env,
    ),
  }
}

/** Runs the full suite loop: resolve input, execute tasks, then optionally publish the run. */
export async function runSuiteCommand(
  options: SuiteCommandOptions,
  deps: SuiteCommandDeps = {},
): Promise<void> {
  const runEval = deps.runEval ?? defaultRunEval
  const resolved = await resolveSuiteCommand(options)
  const runOptions: RunEvalOptions =
    resolved.kind === 'config'
      ? { configPath: resolved.configPath }
      : {
          configPath: resolved.suitePath,
          dataPath: resolved.datasetPath,
          config: resolved.evalConfig,
        }

  const result = await runEval(runOptions)
  if (!options.publishTarget) return

  const outputDir = result?.outputDir
  if (!outputDir) {
    throw new Error('publish requested but runner did not return an outputDir')
  }
  if (!deps.publishRun) {
    throw new Error('publish requested before the publisher is configured')
  }
  await deps.publishRun({ runDir: outputDir, target: options.publishTarget })
}
