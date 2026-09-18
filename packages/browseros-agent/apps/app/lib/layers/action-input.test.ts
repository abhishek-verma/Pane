import { expect, it } from 'bun:test'
import { layerDefinitionSchema } from '@browseros/shared/layers/manifest'
import { parseLayerActionInput } from './action-input'
import { scriptRequestErrorMessage } from './script-errors'

const action = layerDefinitionSchema.parse({
  protocol: 'pane.layers.v1',
  mode: 'javascript',
  name: 'Draw',
  intent: 'Visualise changes',
  scope: { origin: 'https://github.com', paths: ['/*'] },
  operations: [],
  source: 'void 0;',
  actions: [
    {
      id: 'draw',
      kind: 'page-task',
      execution: 'javascript',
      trigger: 'click',
      instruction: 'Draw the observed changes.',
      providerId: 'claude-code',
      outputSchema: 'pane.script-task-receipt.v1',
      limits: { maxSteps: 8, maxOutputTokens: 8192, deadlineMs: 30000 },
    },
  ],
}).actions[0]
it('accepts the exact generated-script marker for the declared action', () => {
  expect(
    parseLayerActionInput(action, { schema: 'pane.script-task-input.v1' }),
  ).toEqual({ schema: 'pane.script-task-input.v1' })
})
it('reports the supplied unsupported brief fields as an input error without exposing their values', () => {
  try {
    parseLayerActionInput(action, {
      schema: 'pane.script-task-input.v1',
      briefSelector: '#private-brief',
      briefBytes: 'sensitive page content',
    })
    throw new Error('Unexpected acceptance')
  } catch (error) {
    const message = scriptRequestErrorMessage(error)
    expect(message).toContain('Invalid generated-script action input')
    expect(message).toContain('no other fields')
    expect(message).not.toContain('sensitive page content')
    expect(message).not.toContain('#private-brief')
    expect(message).not.toContain('no longer authorized')
  }
})
it('rejects mismatched input kinds and undeclared actions', () => {
  expect(() =>
    parseLayerActionInput(action, {
      targetLanguage: 'en',
      blocks: [{ blockId: 'one', text: 'Bonjour' }],
    }),
  ).toThrow('Invalid generated-script')
  expect(() =>
    parseLayerActionInput(undefined, { schema: 'pane.script-task-input.v1' }),
  ).toThrow('saved Layer action')
})
