import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import {
  type AuthenticatedProvider,
  authenticateProvider,
  type PendingDeviceCode,
} from '@/lib/llm-providers/authenticate-provider'
import type { OAuthProviderFlowConfig } from '@/lib/llm-providers/oauth-providers'
import { useOAuthStatus } from './oauth-status.hooks'

export function useProviderAuthentication(
  config: OAuthProviderFlowConfig,
  onAuthenticated: (status: AuthenticatedProvider) => Promise<void> | void,
) {
  const account = useOAuthStatus(config.providerType)
  const [pendingDeviceCode, setPendingDeviceCode] =
    useState<PendingDeviceCode | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const onAuthenticatedRef = useRef(onAuthenticated)
  onAuthenticatedRef.current = onAuthenticated

  const mutation = useMutation({
    mutationFn: async (serverUrl: string) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      setPendingDeviceCode(null)
      try {
        const status = await authenticateProvider(config, serverUrl, {
          signal: controller.signal,
          onDeviceCode: setPendingDeviceCode,
        })
        controller.signal.throwIfAborted()
        await account.refresh()
        controller.signal.throwIfAborted()
        await onAuthenticatedRef.current(status)
      } finally {
        if (
          controllerRef.current === controller &&
          !controller.signal.aborted
        ) {
          setPendingDeviceCode(null)
        }
      }
    },
  })

  function cancel() {
    controllerRef.current?.abort()
    controllerRef.current = null
    setPendingDeviceCode(null)
    mutation.reset()
  }

  useEffect(
    () => () => {
      controllerRef.current?.abort()
    },
    [],
  )

  return {
    ...account,
    pendingDeviceCode,
    isPending: mutation.isPending,
    error: mutation.error?.message,
    start: (serverUrl: string) => mutation.mutateAsync(serverUrl),
    cancel,
  }
}
