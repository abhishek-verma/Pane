import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_TERMINAL_DENYLIST,
  defaultWorkspace,
  isDenied,
} from '../../../src/tools/filesystem/workspace'

describe('defaultWorkspace', () => {
  it('sets defaults for a root path', () => {
    const ws = defaultWorkspace('/foo')
    expect(ws.root).toBe('/foo')
    expect(ws.scope).toBe('write')
    expect(ws.bucketId).toBe('default')
    expect(ws.terminalPolicy.denylist).toEqual([...DEFAULT_TERMINAL_DENYLIST])
  })

  it('applies overrides', () => {
    const ws = defaultWorkspace('/foo', {
      scope: 'read',
      bucketId: 'project-a',
    })
    expect(ws.scope).toBe('read')
    expect(ws.bucketId).toBe('project-a')
  })
})

describe('isDenied', () => {
  const policy = defaultWorkspace('/tmp').terminalPolicy

  it('blocks sudo commands', () => {
    expect(isDenied('sudo apt update', policy)).toEqual({
      denied: true,
      reason: 'matched denylist entry: sudo ',
    })
  })

  it('allows benign commands', () => {
    expect(isDenied('ls -la', policy)).toEqual({ denied: false })
  })

  it('blocks rm -rf /', () => {
    expect(isDenied('rm -rf /', policy).denied).toBe(true)
  })

  it('allows curl and wget', () => {
    expect(isDenied('curl https://example.com', policy).denied).toBe(false)
    expect(isDenied('wget https://example.com', policy).denied).toBe(false)
  })

  it('enforces allowlist when set', () => {
    const allowPolicy = { denylist: [], allowlist: ['ls'] }
    expect(isDenied('ls -la', allowPolicy).denied).toBe(false)
    expect(isDenied('rm file', allowPolicy).denied).toBe(true)
  })
})
