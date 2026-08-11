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

  test('ChatMermaidBlock defines one shared mermaid renderer plugin config', () => {
    // plugins={{}} does NOT disable Streamdown's own built-in Mermaid
    // renderer (that's gated by a separate top-level `mermaid` prop) — a
    // custom `plugins.renderers` entry for language "mermaid" is the one
    // hook Streamdown checks before ever reaching its own Mermaid renderer.
    // A hand-rolled regex pre-splitting ```mermaid fences out of the text
    // (the previous approach) can only approximate CommonMark fence rules
    // and will eventually disagree with Streamdown's real parser, letting a
    // fence slip through uncaught — this crashed the whole panel with React
    // error #185 in production twice. Defined once here (not per call site)
    // so ChatMarkdown/PiMarkdown/reasoning.tsx can't drift out of sync.
    const src = readFileSync(
      join(appRoot, 'components/tool-evidence/ChatMermaidBlock.tsx'),
      'utf8',
    )
    expect(src).toContain("language: 'mermaid'")
    expect(src).toContain('ChatMermaidStreamdownRenderer')
    expect(src).toContain('renderMermaidInSandbox')
    expect(src).toContain('MERMAID_RENDERER_PLUGINS')
    expect(src).toContain('normalizeMermaidFenceCase')
    expect(src).not.toMatch(/from ['"]mermaid['"]/)
  })

  test('ChatMarkdown, PiMarkdown, and reasoning all route mermaid through the shared sandboxed renderer', () => {
    // Same Streamdown-built-in-Mermaid crash class, different call sites —
    // chat text, PI page prose, and reasoning blocks all render arbitrary
    // model text through Streamdown (reasoning.tsx previously had no guard
    // at all). Each must both register the shared renderer plugin and
    // case-normalize fence language tags before Streamdown ever sees the
    // text — Streamdown's own renderer lookup is a case-sensitive `===`.
    for (const path of [
      'components/tool-evidence/ChatMarkdown.tsx',
      'screens/personal-internet/PiMarkdown.tsx',
      'components/ai-elements/reasoning.tsx',
    ]) {
      const src = readFileSync(join(appRoot, path), 'utf8')
      expect(src).toContain('MERMAID_RENDERER_PLUGINS')
      expect(src).toContain('normalizeMermaidFenceCase')
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
