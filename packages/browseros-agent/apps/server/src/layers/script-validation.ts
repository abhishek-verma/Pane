import type { LayerDefinition } from '@browseros/shared/layers/manifest'
import { parse } from 'acorn'

/** Compile only; never execute author source on the server. Browser assertions
 * and real interaction remain necessary to verify intended page behavior. */
export function validateLayerSource(
  definition: Pick<LayerDefinition, 'mode' | 'source'>,
): void {
  if (definition.mode !== 'javascript') return
  try {
    // Bun's vm.Script defers syntax errors until execution. Parse explicitly
    // so malformed candidates are rejected without ever running their source.
    parse(definition.source ?? '', { ecmaVersion: 2025, sourceType: 'script' })
  } catch {
    throw new Error(
      'JavaScript source is not a valid standalone script. Use async callbacks for awaited work; module imports and top-level await are not supported.',
    )
  }
}
