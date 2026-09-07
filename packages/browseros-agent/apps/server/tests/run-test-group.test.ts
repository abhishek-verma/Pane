/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import {
  buildTestCommand,
  getAtomicGroupTargets,
  listAllGroups,
  withTestEnv,
} from './__helpers__/run-test-group'

describe('withTestEnv', () => {
  it('defaults NODE_ENV to test when absent', () => {
    expect(withTestEnv({ PATH: '/usr/bin' }).NODE_ENV).toBe('test')
  })

  it('preserves an explicit NODE_ENV', () => {
    expect(withTestEnv({ NODE_ENV: 'production' }).NODE_ENV).toBe('production')
  })
})

describe('buildTestCommand', () => {
  it('runs targets through the isolated test runner', () => {
    const command = buildTestCommand(['./tests/api'])
    expect(command.slice(0, 2)).toEqual([process.execPath, 'run'])
    expect(command[2]).toEndWith('/scripts/run-bun-test.ts')
    expect(command[3]).toEndWith('/apps/server/tests/api')
  })
})

describe('test groups', () => {
  it('includes the lib tests in the group list', () => {
    expect(listAllGroups()).toContain('lib')
  })

  it('runs available integration tests in the integration group', () => {
    expect(getAtomicGroupTargets('integration')).toEqual([
      './tests/server.integration.test.ts',
    ])
  })

  it('does not duplicate group names', () => {
    const groups = listAllGroups()

    expect(new Set(groups).size).toBe(groups.length)
  })
})
