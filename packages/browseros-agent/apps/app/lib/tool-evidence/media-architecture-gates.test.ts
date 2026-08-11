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

  test('ChatMarkdown routes mermaid through a Streamdown custom renderer', () => {
    // plugins={{}} does NOT disable Streamdown's own built-in Mermaid
    // renderer (that's gated by a separate top-level `mermaid` prop) — a
    // custom `plugins.renderers` entry for language "mermaid" is the one
    // hook Streamdown checks before ever reaching its own Mermaid renderer.
    // A hand-rolled regex pre-splitting ```mermaid fences out of the text
    // (the previous approach) can only approximate CommonMark fence rules
    // and will eventually disagree with Streamdown's real parser, letting a
    // fence slip through uncaught — this crashed the whole panel with React
    // error #185 in production twice.
    const src = readFileSync(
      join(appRoot, 'components/tool-evidence/ChatMarkdown.tsx'),
      'utf8',
    )
    expect(src).toContain("language: 'mermaid'")
    expect(src).toContain('ChatMermaidStreamdownRenderer')
    expect(src).not.toMatch(/from ['"]mermaid['"]/)
  })

  test('ChatMermaidStreamdownRenderer defers to the sandboxed broker, not raw mermaid', () => {
    const src = readFileSync(
      join(appRoot, 'components/tool-evidence/ChatMermaidBlock.tsx'),
      'utf8',
    )
    expect(src).toContain('ChatMermaidStreamdownRenderer')
    expect(src).toContain('renderMermaidInSandbox')
    expect(src).not.toMatch(/from ['"]mermaid['"]/)
  })

  test('PiMarkdown and reasoning also route mermaid through the sandboxed renderer', () => {
    // Same Streamdown-built-in-Mermaid crash class, different call sites —
    // PiMarkdown page prose and reasoning blocks render arbitrary model
    // text through Streamdown too and had no guard at all (reasoning.tsx
    // did not even pass plugins={{}}).
    for (const path of [
      'screens/personal-internet/PiMarkdown.tsx',
      'components/ai-elements/reasoning.tsx',
    ]) {
      const src = readFileSync(join(appRoot, path), 'utf8')
      expect(src).toContain("language: 'mermaid'")
      expect(src).toContain('ChatMermaidStreamdownRenderer')
    }
  })

  test('BrowserActionCard loads stripped stills via resolveToolImageBlobUrl', () => {
    const src = readFileSync(
      join(appRoot, 'components/tool-evidence/BrowserActionCard.tsx'),
      'utf8',
    )
    expect(src).toContain('resolveToolImageBlobUrl')
    expect(src).not.toMatch(/tool-images\/\$\{/)
  })

  test('CORS allows the profile isolation header for agentFetch', () => {
    const src = readFileSync(
      join(import.meta.dirname, '../../../server/src/api/utils/cors.ts'),
      'utf8',
    )
    expect(src).toContain('BROWSEROS_PROFILE_ID_HEADER')
  })
})
