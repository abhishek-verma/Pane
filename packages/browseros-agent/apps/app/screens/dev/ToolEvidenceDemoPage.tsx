import type { FC } from 'react'
import type { ToolEvidenceSource } from '@/components/tool-evidence/ToolEvidenceList'
import { ToolEvidenceList } from '@/components/tool-evidence/ToolEvidenceList'

/** 1×1 PNG */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const FIXTURES: ToolEvidenceSource[] = [
  {
    toolCallId: 'f1',
    toolName: 'filesystem_edit',
    state: 'output-available',
    input: {
      path: 'README.md',
      old_string: 'browswer',
      new_string: 'browser',
    },
    output: {
      content: [
        {
          type: 'text',
          text: 'Applied edit to README.md\n\n- Pane is an agentic browswer\n+ Pane is an agentic browser',
        },
      ],
    },
  },
  {
    toolCallId: 'f2',
    toolName: 'filesystem_edit',
    state: 'output-available',
    input: {
      path: 'README.md',
      old_string: 'foo',
      new_string: 'bar',
    },
    output: {
      content: [
        {
          type: 'text',
          text: 'Applied edit to README.md\n\n- foo\n+ bar',
        },
      ],
    },
  },
  {
    toolCallId: 'b1',
    toolName: 'act',
    state: 'output-available',
    input: { page: 1, kind: 'click', ref: 'e12' },
    label: 'Clicked',
    subject: 'Submit',
    output: {
      content: [
        { type: 'text', text: 'ok (click)\n[Page 1 diff] +2 −0' },
        { type: 'image', mimeType: 'image/png', data: TINY_PNG },
      ],
      structuredContent: {
        kind: 'click',
        changed: true,
        added: 2,
        removed: 0,
      },
    },
  },
  {
    toolCallId: 't1',
    toolName: 'filesystem_bash',
    state: 'output-available',
    input: { command: 'bun test lib/tool-evidence' },
    output: {
      content: [
        {
          type: 'text',
          text: '35 pass\n0 fail\n\n[Exit code: 0]',
        },
      ],
    },
  },
  {
    toolCallId: 'a1',
    toolName: 'execute_action',
    state: 'output-available',
    input: {
      server_name: 'slack',
      action: 'chat_postMessage',
      channel: '#eng',
    },
    output: {
      content: [{ type: 'text', text: 'Message sent to #eng' }],
    },
  },
  {
    toolCallId: 'g1',
    toolName: 'snapshot',
    state: 'output-available',
    input: { page: 1 },
    output: {
      content: [{ type: 'text', text: 'Accessibility tree…' }],
    },
  },
  {
    toolCallId: 'g2',
    toolName: 'wait',
    state: 'output-available',
    input: { time: 1 },
    output: { content: [{ type: 'text', text: 'done' }] },
  },
]

/** Dev-only fixture gallery for tool-evidence cards (E2E / visual QA). */
export const ToolEvidenceDemoPage: FC = () => {
  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <div>
        <h1 className="font-semibold text-lg">Tool evidence demo</h1>
        <p className="text-muted-foreground text-sm">
          Fixture cards for file, browser, terminal, app-send, and generics —
          including coalesce, replay, and expand.
        </p>
      </div>
      <ToolEvidenceList tools={FIXTURES} allowStepReplay preferGenericsOpen />
    </div>
  )
}
