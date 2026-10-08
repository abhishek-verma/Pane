/** Isolated checkpoint benchmark; no profile, server or network access. */
import assert from 'node:assert/strict'
import type { UIMessage } from 'ai'
import { stripUIImageOutputs } from '../../apps/server/src/agent/message-validation'
import {
  projectMessagesForUi,
  projectMessagesSnapshotForUi,
} from '../../apps/server/src/agent/project-messages-for-ui'

const messages: UIMessage[] = Array.from({ length: 180 }, (_, index) => ({
  id: String(index),
  role: 'assistant',
  parts: [
    {
      type: 'tool-research',
      toolCallId: `call-${index}`,
      state: 'output-available',
      input: { query: `query ${index}` },
      output: {
        content: [
          {
            type: 'text',
            text: `${index}:` + 'Research output. '.repeat(8192),
          },
        ],
      },
    } as never,
  ],
}))
const options = {
  sessionId: 'synthetic',
  imageStore: { store: () => true } as never,
  outputStore: { store: () => true } as never,
}
const oldProjection = () => {
  const clone = structuredClone(messages)
  stripUIImageOutputs(clone, options.sessionId, options.imageStore)
  return projectMessagesForUi(clone, options)
}
const newProjection = () => projectMessagesSnapshotForUi(messages, options)
assert.deepEqual(
  newProjection(),
  oldProjection(),
  'Wire content must be identical',
)
const samples = { before: [] as number[], after: [] as number[] }
for (let index = 0; index < 24; index++) {
  // Alternate order to reduce warmup / GC ordering bias.
  for (const key of index % 2
    ? (['after', 'before'] as const)
    : (['before', 'after'] as const)) {
    const start = performance.now()
    const result = key === 'before' ? oldProjection() : newProjection()
    samples[key].push(performance.now() - start)
    assert.equal(result.length, 60)
  }
}
const median = (values: number[]) =>
  values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
console.log(
  JSON.stringify(
    {
      sourceBytes: Buffer.byteLength(JSON.stringify(messages)),
      wireBytes: Buffer.byteLength(JSON.stringify(newProjection())),
      snapshotsPerPath: 24,
      beforeMedianMs: median(samples.before),
      afterMedianMs: median(samples.after),
      wireIdentical: true,
    },
    null,
    2,
  ),
)
