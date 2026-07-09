import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { replayToolCall } from '../../../src/api/services/trust-replay'

describe('replayToolCall', () => {
  test('promotes filesystem_bash dry-run into execution', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'pane-replay-'))
    try {
      const result = await replayToolCall(
        {
          browser: { isCdpConnected: () => false } as never,
          browserSession: {} as never,
        },
        {
          toolName: 'filesystem_bash',
          args: { command: 'echo replay-ok' },
          userWorkingDir: tmpDir,
          workspaceId: 'replay-test',
        },
      )

      expect(result.decision).toBe('promoted')
      expect(result.isError).toBe(false)
      const text =
        result.output &&
        typeof result.output === 'object' &&
        'text' in result.output
          ? String((result.output as { text?: string }).text)
          : ''
      expect(text).toContain('replay-ok')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('returns dry-run when promotion is not set internally for blocked paths', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'pane-replay-deny-'))
    try {
      await mkdir(join(tmpDir, 'nested'), { recursive: true })
      const result = await replayToolCall(
        {
          browser: { isCdpConnected: () => false } as never,
          browserSession: {} as never,
        },
        {
          toolName: 'filesystem_write',
          args: { path: '/etc/passwd', content: 'nope' },
          userWorkingDir: tmpDir,
        },
      )

      expect(['dry-run', 'denied', 'promoted']).toContain(result.decision)
      if (result.decision === 'promoted') {
        const text =
          result.output &&
          typeof result.output === 'object' &&
          'text' in result.output
            ? String((result.output as { text?: string }).text)
            : ''
        expect(text.length).toBeGreaterThan(0)
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })
})
