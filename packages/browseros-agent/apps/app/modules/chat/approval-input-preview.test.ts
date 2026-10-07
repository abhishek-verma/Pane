import { expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import { slimMessagesForClientUi } from '@/lib/tool-evidence/slim-messages-for-client-ui'
import { patchToolInvocationInput } from '@/lib/trust/patch-tool-output'
import { collectToolApprovalResponses } from './collect-tool-approval-responses'

for (const type of ['tool-write', 'dynamic-tool']) {
  test(`${type}: previews never become approval argument overrides, but reviewed edits survive`, () => {
    const input = { content: 'Original input'.repeat(10_000) }
    const messages = [
      {
        id: 'm',
        role: 'assistant',
        parts: [
          {
            type,
            toolName: 'write',
            toolCallId: 'call',
            state: 'approval-responded',
            input,
            approval: { id: 'approval', approved: true },
          },
        ],
      },
    ] as UIMessage[]
    const preview = slimMessagesForClientUi(messages)
    expect(preview[0].parts[0]).toMatchObject({ inputPreviewed: true })
    expect(collectToolApprovalResponses(preview)[0].input).toBeUndefined()
    const edited = { content: 'Reviewed edit'.repeat(10_000) }
    const patched = patchToolInvocationInput(preview, 'call', edited)
    const submitted = slimMessagesForClientUi(patched)
    expect(JSON.stringify(submitted).length).toBeLessThan(16_000)
    expect(collectToolApprovalResponses(submitted)[0].input).toBeUndefined()
    expect(
      collectToolApprovalResponses(submitted, new Map([['call', edited]]))[0]
        .input,
    ).toEqual(edited)
    expect((messages[0].parts[0] as { input: unknown }).input).toBe(input)
  })
}
