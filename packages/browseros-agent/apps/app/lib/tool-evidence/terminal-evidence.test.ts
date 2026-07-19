import { describe, expect, test } from 'bun:test'
import { buildTerminalDetail } from './terminal-evidence'

describe('buildTerminalDetail', () => {
  test('success with output → exit 0', () => {
    const d = buildTerminalDetail({
      input: { command: 'echo hi' },
      outputText: 'hi\n',
      isError: false,
    })
    expect(d.command).toBe('echo hi')
    expect(d.exitCode).toBe(0)
    expect(d.stdout).toBe('hi\n')
    expect(d.truncated).toBeUndefined()
  })

  test('parses non-zero exit trailer', () => {
    const d = buildTerminalDetail({
      input: { command: 'false' },
      outputText: 'oops\n\n[Exit code: 1]',
      isError: true,
    })
    expect(d.exitCode).toBe(1)
    expect(d.stdout).toBe('oops')
  })

  test('detects truncation preamble', () => {
    const d = buildTerminalDetail({
      input: { command: 'yes' },
      outputText:
        '(Output truncated. Showing last 2000 of 9000 lines)\nline\n\n[Exit code: 141]',
      isError: true,
    })
    expect(d.truncated).toBe(true)
    expect(d.exitCode).toBe(141)
    expect(d.stdout).toBe('line')
  })

  test('empty success output', () => {
    const d = buildTerminalDetail({
      input: { command: 'true' },
      outputText: '(no output)',
      isError: false,
    })
    expect(d.exitCode).toBe(0)
    expect(d.stdout).toBeUndefined()
  })

  test('timeout has no exit code', () => {
    const d = buildTerminalDetail({
      input: { command: 'sleep 99' },
      outputText: 'Command timed out after 30s\n\npartial',
      isError: true,
    })
    expect(d.exitCode).toBeUndefined()
    expect(d.stdout).toContain('timed out')
  })
})
