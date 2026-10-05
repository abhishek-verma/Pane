import { describe, expect, it } from 'bun:test'
import { getModelsDevProvider } from './models-dev'
import { providerTemplates } from './providerTemplates'

describe('providerTemplates', () => {
  it('uses ChatGPT as the display name for new ChatGPT providers', () => {
    const template = providerTemplates.find(
      (provider) => provider.id === 'chatgpt-pro',
    )

    expect(template).toMatchObject({
      name: 'ChatGPT',
      defaultModelId: 'gpt-6-astra',
      contextWindow: 1050000,
    })
  })
})

it('keeps catalog-backed defaults and capabilities aligned with the snapshot', () => {
  for (const template of providerTemplates) {
    const provider = getModelsDevProvider(template.id)
    if (!provider || !template.defaultModelId) continue
    const model = provider.models.find(
      (model) => model.id === template.defaultModelId,
    )
    if (!model) throw new Error(`Missing default model for ${template.id}`)
    expect(template.contextWindow).toBe(model.contextWindow)
    expect(template.supportsImages).toBe(model.supportsImages)
  }
})
