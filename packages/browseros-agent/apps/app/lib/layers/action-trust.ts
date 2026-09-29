import {
  requireBrowserInputApprovalStorage,
  trustPinsStorage,
} from '@/lib/trust/trust-pins-storage'

/** Each Layer click starts a new conversation. Only current global trust
 * carries across; chat-only approvals belong to their original conversation. */
export async function readLayerActionTrust() {
  const [trustPins, requireBrowserInputApproval] = await Promise.all([
    trustPinsStorage.getValue(),
    requireBrowserInputApprovalStorage.getValue(),
  ])
  return {
    trustPins: structuredClone(trustPins ?? {}),
    requireBrowserInputApproval: requireBrowserInputApproval ?? false,
  }
}
