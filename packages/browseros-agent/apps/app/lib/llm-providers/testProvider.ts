import { agentFetch } from '@/lib/browseros/agent-fetch'
import { PRODUCT_NAME } from '@/lib/constants/product'
import type { LlmProviderConfig } from './types'

/**
 * @public
 */
export interface TestResult {
  success: boolean
  message: string
  responseTime?: number
}

/**
 * Test a provider connection via the agent server's /test-provider endpoint.
 * This uses the same code path as actual chat requests, ensuring accurate validation.
 * @public
 */
export async function testProvider(
  provider: LlmProviderConfig,
  agentServerUrl: string,
): Promise<TestResult> {
  const startTime = performance.now()
  let response: Response

  try {
    response = await agentFetch(`${agentServerUrl}/test-provider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: provider.type,
        model: provider.modelId,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        // Azure
        resourceName: provider.resourceName,
        // Bedrock
        region: provider.region,
        accessKeyId: provider.accessKeyId,
        secretAccessKey: provider.secretAccessKey,
        sessionToken: provider.sessionToken,
        // ACP-backed providers reach the probe via the same endpoint.
        acpAgentId: provider.acpAgentId,
        acpCommand: provider.acpCommand,
        acpFixedWorkspacePath: provider.acpFixedWorkspacePath,
      }),
    })
  } catch (error) {
    // The request never reached the server (not running, wrong port, CORS).
    // Distinct from a parse failure below: that means the server WAS
    // reached and responded, just not with valid JSON.
    const responseTime = Math.round(performance.now() - startTime)
    const underlying = error instanceof Error ? error.message : String(error)

    return {
      success: false,
      message: `Could not reach the local ${PRODUCT_NAME} server at ${agentServerUrl}. Make sure ${PRODUCT_NAME} is running and try again. (${underlying})`,
      responseTime,
    }
  }

  try {
    const result = (await response.json()) as TestResult

    if (!result.responseTime) {
      result.responseTime = Math.round(performance.now() - startTime)
    }

    return result
  } catch (error) {
    const responseTime = Math.round(performance.now() - startTime)
    const underlying = error instanceof Error ? error.message : String(error)

    return {
      success: false,
      message: `Received an unexpected response from the local ${PRODUCT_NAME} server. (${underlying})`,
      responseTime,
    }
  }
}
