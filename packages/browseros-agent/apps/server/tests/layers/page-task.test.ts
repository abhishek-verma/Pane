import { expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  pageTaskInputSchema,
  pageTaskResultSchema,
} from '@browseros/shared/layers/action-protocol'
import { PageTaskResultSink } from '../../src/layers/result-acceptance'
import { createPageTaskResultTool } from '../../src/layers/result-tool'

const binding = {
  profileId: randomUUID(),
  invocationId: 'run',
  layerId: 'focus',
  layerVersion: 'a'.repeat(64),
  actionId: 'focus',
  tabId: 1,
  frameId: 0 as const,
  documentId: 'document',
  instanceId: 'instance',
  routeEpoch: 0,
  snapshotId: 'snapshot',
  revocationGeneration: 1,
}
const input = pageTaskInputSchema.parse({
  schema: 'pane.page-task-input.v1',
  nodes: [{ nodeId: 'aside', role: 'aside', text: 'Recommendations' }],
})
const output = pageTaskResultSchema.parse({
  schema: 'pane.page-task-receipt.v1',
  operations: [{ nodeId: 'aside', kind: 'collapse', label: 'recommendations' }],
})

it('accepts only captured handles and reversible packaged operations', () => {
  const sink = new PageTaskResultSink(binding, input, 1000, () => 1)
  expect(
    sink.submit(
      {
        ...output,
        operations: [{ ...output.operations[0], nodeId: 'outside' }],
      },
      binding,
    ).accepted,
  ).toBe(false)
  expect(
    sink.submit(
      {
        ...output,
        operations: [{ ...output.operations[0], selector: 'body' }],
      },
      binding,
    ).accepted,
  ).toBe(false)
  expect(
    sink.submit(
      { ...output, operations: [{ ...output.operations[0], kind: 'script' }] },
      binding,
    ).accepted,
  ).toBe(false)
  expect(
    sink.submit(
      { ...output, operations: [...output.operations, ...output.operations] },
      binding,
    ).accepted,
  ).toBe(false)
  expect(sink.submit(output, binding)).toMatchObject({
    accepted: true,
    duplicate: false,
  })
  expect(sink.submit(output, binding)).toMatchObject({
    accepted: true,
    duplicate: true,
  })
  expect(
    sink.submit(
      {
        ...output,
        operations: [{ ...output.operations[0], kind: 'highlight' }],
      },
      binding,
    ),
  ).toMatchObject({ accepted: false, code: 'CONFLICT' })
})

it('rejects stale identity, expired grants and cancellation independently of result validity', () => {
  const sink = new PageTaskResultSink(binding, input, 1000, () => 1)
  expect(
    sink.submit(output, { ...binding, snapshotId: 'other' }),
  ).toMatchObject({ accepted: false, code: 'STALE_CONTEXT' })
  sink.cancel()
  expect(sink.submit(output, binding)).toMatchObject({
    accepted: false,
    code: 'CANCELLED',
  })
  expect(
    new PageTaskResultSink(binding, input, 1000, () => 1000).submit(
      output,
      binding,
    ),
  ).toMatchObject({ accepted: false, code: 'EXPIRED' })
})

it('bounds repair attempts and publishes a private page plan only once', async () => {
  let deliveries = 0
  const tools = createPageTaskResultTool({
    sink: new PageTaskResultSink(binding, input, Date.now() + 10000),
    currentBinding: () => binding,
    accepted: () => {
      deliveries += 1
    },
  })
  const execute = tools.submit_layer_result.execute
  if (!execute) throw new Error('Missing terminal tool')
  const options = { toolCallId: 'private', messages: [] }
  expect(await execute(output, options)).toMatchObject({
    accepted: true,
    duplicate: false,
  })
  expect(await execute(output, options)).toMatchObject({
    accepted: true,
    duplicate: true,
  })
  expect(deliveries).toBe(1)
  const bad = createPageTaskResultTool({
    sink: new PageTaskResultSink(binding, input, Date.now() + 10000),
    currentBinding: () => binding,
    accepted: () => {
      throw new Error('Invalid plan published')
    },
  }).submit_layer_result.execute
  if (!bad) throw new Error('Missing terminal tool')
  const forged = {
    ...output,
    operations: [{ ...output.operations[0], nodeId: 'outside' }],
  }
  expect(await bad(forged, options)).toMatchObject({ repairRemaining: true })
  expect(await bad(forged, options)).toMatchObject({ repairRemaining: false })
  expect(await bad(output, options)).toMatchObject({ accepted: false })
})
