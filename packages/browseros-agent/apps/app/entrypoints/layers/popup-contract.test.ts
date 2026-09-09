import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

describe('Layers popup document', () => {
  it('declares its width before the module loads so Chromium can size the host', () => {
    const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
    const style = html.indexOf('<style>')
    const script = html.indexOf('<script type="module"')

    expect(style).toBeGreaterThan(-1)
    expect(style).toBeLessThan(script)
    expect(html).toContain('width:360px')
    expect(html).toContain('min-width:360px')
    expect(html).not.toContain('max-width:100vw')
  })
})
