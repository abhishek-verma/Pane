import { describe, expect, it } from 'bun:test'
import { getModelContextLength, getModelsForProvider } from './models'

describe('provider models', () => {
  it('offers GPT-6 with current metadata for ChatGPT', () => {
    expect(getModelsForProvider('chatgpt-pro')[0]).toMatchObject({
      modelId: 'gpt-6-astra',
      contextLength: 1050000,
      supportsImages: true,
    })
    expect(getModelContextLength('chatgpt-pro', 'gpt-6-luna')).toBe(1050000)
  })

  it('does not offer API-only Pro models for ChatGPT', () => {
    expect(
      getModelsForProvider('chatgpt-pro').some((model) =>
        model.modelId.endsWith('-pro'),
      ),
    ).toBe(false)
  })

  it('uses live metadata before the bundled catalog', () => {
    expect(
      getModelsForProvider('deepseek', [
        {
          id: 'new-model',
          name: 'New Model',
          contextWindow: 123456,
          maxOutput: 8192,
          supportsImages: true,
          supportsReasoning: false,
          supportsToolCall: true,
        },
      ]),
    ).toEqual([
      {
        modelId: 'new-model',
        contextLength: 123456,
        supportsImages: true,
        supportsReasoning: false,
        supportsToolCall: true,
      },
    ])
  })

  it('falls back to the bundled catalog when refresh is empty', () => {
    expect(getModelsForProvider('cerebras', [])).toEqual(
      getModelsForProvider('cerebras'),
    )
    expect(getModelsForProvider('cerebras').length).toBeGreaterThan(0)
  })

  it('keeps local/custom and Qwen endpoint-specific choices', () => {
    expect(getModelsForProvider('openai-compatible')).toEqual([])
    expect(getModelsForProvider('ollama')).toEqual([])
    expect(getModelsForProvider('qwen-code')[0]?.modelId).toBe('coder-model')
  })
})
