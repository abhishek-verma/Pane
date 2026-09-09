import {
  type TranslationInput,
  translationInputSchema,
  translationResultSchema,
} from '@browseros/shared/layers/action-protocol'
import { LAYER_LIMITS } from '@browseros/shared/layers/manifest'

interface CapturedBlock {
  blockId: string
  element: HTMLElement
  text: string
}
const excluded =
  'form,input,textarea,select,button,script,style,[contenteditable]:not([contenteditable="false"]),[data-pane-layer-owned],[aria-hidden="true"]'

/** A snapshot holds live references privately. Only bounded text and opaque
 * block IDs leave the content world; selectors/HTML are never model output. */
export class LayerTranslationSnapshot {
  private readonly blocks: CapturedBlock[] = []
  private readonly outputs: HTMLElement[] = []
  private readonly url: string
  private observer?: MutationObserver
  private invalid = false
  private readonly snapshotInput: TranslationInput
  get input(): TranslationInput {
    return structuredClone(this.snapshotInput)
  }

  constructor(
    private readonly anchor: HTMLElement,
    targetLanguage: string,
  ) {
    this.url = anchor.ownerDocument.location.href
    let characters = 0
    const blockSelector = 'p,h1,h2,h3,h4,h5,h6,li,blockquote'
    const candidates = anchor.matches(blockSelector)
      ? [anchor]
      : Array.from(anchor.querySelectorAll<HTMLElement>(blockSelector))
    if (candidates.length > 10_000)
      throw new Error('This section is too large. Choose a smaller section.')
    for (const element of candidates) {
      if (element.closest(excluded) || element.querySelector(excluded)) continue
      // Capture leaf blocks, avoiding duplicate text from nested lists/quotes.
      if (element.querySelector('p,li,blockquote')) continue
      if (!element.checkVisibility({ checkVisibilityCSS: true })) continue
      const text = element.textContent?.trim()
      if (!text) continue
      if (
        text.length > LAYER_LIMITS.blockCharacters ||
        this.blocks.length >= LAYER_LIMITS.blocks ||
        characters + text.length > LAYER_LIMITS.resultCharacters
      )
        throw new Error(
          'This section exceeds the translation limit. Choose a smaller section.',
        )
      characters += text.length
      this.blocks.push({ blockId: crypto.randomUUID(), element, text })
    }
    this.snapshotInput = translationInputSchema.parse({
      targetLanguage,
      blocks: this.blocks.map(({ blockId, text }) => ({ blockId, text })),
    })
  }

  current(): boolean {
    return (
      !this.invalid &&
      this.anchor.isConnected &&
      this.anchor.ownerDocument.location.href === this.url &&
      this.blocks.every(
        ({ element, text }) =>
          this.anchor.contains(element) && element.textContent?.trim() === text,
      )
    )
  }

  render(value: unknown): 'rendered' | 'stale' | 'invalid' {
    if (!this.current()) return 'stale'
    const parsed = translationResultSchema.safeParse(value)
    if (
      !parsed.success ||
      parsed.data.targetLanguage !== this.input.targetLanguage ||
      parsed.data.blocks.length !== this.blocks.length
    )
      return 'invalid'
    const byId = new Map(
      parsed.data.blocks.map((block) => [block.blockId, block.translatedText]),
    )
    if (
      byId.size !== this.blocks.length ||
      this.blocks.some((block) => !byId.has(block.blockId))
    )
      return 'invalid'
    this.clearOutputs()
    for (const block of this.blocks) {
      const text = byId.get(block.blockId)
      if (text === undefined) return 'invalid'
      const host = this.anchor.ownerDocument.createElement('div')
      host.dataset.paneLayerOwned = 'translation'
      const shadow = host.attachShadow({ mode: 'open' })
      const style = this.anchor.ownerDocument.createElement('style')
      style.textContent =
        ':host{display:block;margin:8px 0}section{font:inherit;padding:10px 12px;border-inline-start:3px solid #718a35;background:Canvas;color:CanvasText}small{display:block;font:12px system-ui;margin-bottom:6px;opacity:.7}p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}'
      const section = this.anchor.ownerDocument.createElement('section')
      const label = this.anchor.ownerDocument.createElement('small')
      label.textContent = `Pane translation · ${this.input.targetLanguage}`
      label.dir = 'auto'
      const paragraph = this.anchor.ownerDocument.createElement('p')
      paragraph.textContent = text
      paragraph.lang = this.input.targetLanguage
      paragraph.dir = 'auto'
      section.append(label, paragraph)
      shadow.append(style, section)
      block.element.after(host)
      this.outputs.push(host)
    }
    this.observer = new MutationObserver(() => {
      if (!this.current()) this.dispose()
    })
    this.observer.observe(this.anchor.ownerDocument.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    return 'rendered'
  }

  dispose(): void {
    this.invalid = true
    this.clearOutputs()
  }

  private clearOutputs(): void {
    this.observer?.disconnect()
    this.observer = undefined
    for (const output of this.outputs.splice(0)) output.remove()
  }
}
