import type { InstalledLayer } from '@browseros/shared/layers/manifest'

/** Packaged, independent DOM observer. Author code cannot submit its own
 * pass/fail receipt. No assertion evaluates JavaScript or returns page text. */
export function inspectScriptAssertions(
  layer: InstalledLayer,
  doc: Document,
  reload = false,
) {
  const assertions = (layer.definition.assertions ?? []).filter(
    (item) => !reload || !item.afterAction,
  )
  if (!assertions.length)
    throw new Error(
      'Add independent DOM assertions before verifying this script.',
    )
  return assertions.map((assertion) => {
    const nodes = Array.from(doc.querySelectorAll(assertion.selector))
    if (nodes.length > 10000)
      throw new Error('Script assertion match limit exceeded.')
    const intact =
      assertion.state === 'absent'
        ? nodes.length === 0
        : nodes.length > 0 &&
          nodes.length <= assertion.maxMatches &&
          nodes.every((node) => {
            const style = doc.defaultView?.getComputedStyle(node)
            const visible =
              style?.display !== 'none' &&
              style?.visibility !== 'hidden' &&
              style?.visibility !== 'collapse' &&
              Array.from(node.getClientRects()).some(
                (rect) => rect.width > 0 && rect.height > 0,
              )
            return (
              (assertion.state === 'present' ||
                (assertion.state === 'visible' ? visible : !visible)) &&
              (!assertion.textIncludes ||
                (node.textContent ?? '')
                  .slice(0, 16000)
                  .includes(assertion.textIncludes))
            )
          })
    return { operationId: assertion.id, affectedElements: nodes.length, intact }
  })
}
