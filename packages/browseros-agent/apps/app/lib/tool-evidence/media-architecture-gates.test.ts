import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Source-level ship gates: features stay, Mermaid stays out of privileged
 * Streamdown, and tool images go through profile-aware blob fetch.
 */
describe('media architecture ship gates', () => {
  const appRoot = join(import.meta.dirname, '../..')

  test('ChatMessages routes markdown through ChatMarkdown (sandbox Mermaid)', () => {
    const src = readFileSync(
      join(appRoot, 'screens/sidepanel/index/ChatMessages.tsx'),
      'utf8',
    )
    expect(src).toContain('ChatMarkdown')
    expect(src).not.toMatch(/MessageResponse[\s\S]*plugins=\{\{\}\}/)
  })

  test('ChatMarkdown keeps Streamdown plugins empty', () => {
    const src = readFileSync(
      join(appRoot, 'components/tool-evidence/ChatMarkdown.tsx'),
      'utf8',
    )
    expect(src).toContain('plugins={{}}')
    expect(src).toContain('ChatMermaidBlock')
    expect(src).not.toMatch(/from ['"]mermaid['"]/)
  })

  test('BrowserActionCard loads stripped stills via resolveToolImageBlobUrl', () => {
    const src = readFileSync(
      join(appRoot, 'components/tool-evidence/BrowserActionCard.tsx'),
      'utf8',
    )
    expect(src).toContain('resolveToolImageBlobUrl')
    expect(src).not.toMatch(/tool-images\/\$\{/)
  })

  test('PiMarkdown keeps Streamdown plugins empty', () => {
    const src = readFileSync(
      join(appRoot, 'screens/personal-internet/PiMarkdown.tsx'),
      'utf8',
    )
    expect(src).toContain('plugins={{}}')
  })

  test('CORS allows the profile isolation header for agentFetch', () => {
    const src = readFileSync(
      join(import.meta.dirname, '../../../server/src/api/utils/cors.ts'),
      'utf8',
    )
    expect(src).toContain('BROWSEROS_PROFILE_ID_HEADER')
  })
})
