import { describe, expect, test } from 'bun:test'
import { resolveEditorPath } from './open-in-editor'

describe('resolveEditorPath', () => {
  test('returns absolute paths as-is', () => {
    expect(resolveEditorPath('/tmp/foo.ts', '/workspace')).toBe('/tmp/foo.ts')
  })

  test('joins workspace root for relative paths', () => {
    expect(resolveEditorPath('src/a.ts', '/Users/me/proj')).toBe(
      '/Users/me/proj/src/a.ts',
    )
    expect(resolveEditorPath('src/a.ts', '/Users/me/proj/')).toBe(
      '/Users/me/proj/src/a.ts',
    )
  })

  test('returns null without a resolvable path', () => {
    expect(resolveEditorPath('src/a.ts', null)).toBeNull()
    expect(resolveEditorPath('(unknown path)', '/ws')).toBeNull()
  })
})
