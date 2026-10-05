import {
  generateModelsData,
  type ModelsDevProvider,
  type OutputProvider,
} from '../packages/shared/src/model-catalog'

export {
  generateModelsData,
  type ModelsDevModel,
  type ModelsDevProvider,
  type OutputProvider,
  transformModel,
} from '../packages/shared/src/model-catalog'

const API_URL = 'https://models.dev/api.json'
const OUTPUT_PATH = new URL(
  '../packages/shared/src/model-catalog-data.json',
  import.meta.url,
).pathname

export function formatModelsData(
  output: Record<string, OutputProvider>,
): string {
  return `${JSON.stringify(output, null, 2)}\n`
}

/** Fetches live models.dev data and writes the checked-in BrowserOS snapshot. */
export async function main() {
  console.log(`Fetching ${API_URL}...`)
  const response = await fetch(API_URL)
  if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`)

  const data: Record<string, ModelsDevProvider> = await response.json()
  console.log(`Fetched ${Object.keys(data).length} providers`)

  const output = generateModelsData(data)

  const totalModels = Object.values(output).reduce(
    (sum, p) => sum + p.models.length,
    0,
  )
  console.log(
    `Generated ${Object.keys(output).length} providers with ${totalModels} models`,
  )

  await Bun.write(OUTPUT_PATH, formatModelsData(output))
  console.log(`Written to ${OUTPUT_PATH}`)
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
