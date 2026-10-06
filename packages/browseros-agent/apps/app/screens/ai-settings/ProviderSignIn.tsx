import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  OAUTH_PROVIDERS_CONFIG,
  type OAuthProviderType,
} from '@/lib/llm-providers/oauth-providers'
import { useProviderAuthentication } from '@/modules/llm-providers/provider-authentication.hooks'

export function ProviderSignIn({
  providerType,
  serverUrl,
  onAuthenticated,
}: {
  providerType: OAuthProviderType
  serverUrl?: string | null
  onAuthenticated: () => void
}) {
  const config = OAUTH_PROVIDERS_CONFIG[providerType]
  const auth = useProviderAuthentication(config, onAuthenticated)
  return (
    <div className="space-y-3 rounded-lg border p-3 text-sm">
      <p>
        {auth.status?.authenticated
          ? `Signed in to ${config.displayName}${auth.status.email ? ` as ${auth.status.email}` : ''}.`
          : `Sign in with your ${config.displayName} account. No API key needed.`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!serverUrl || auth.isPending}
          onClick={() => {
            if (serverUrl) void auth.start(serverUrl).catch(() => {})
          }}
        >
          {auth.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
          {auth.isPending
            ? 'Waiting for sign-in…'
            : auth.status?.authenticated
              ? 'Sign in again'
              : `Sign in to ${config.displayName}`}
        </Button>
        {auth.isPending && (
          <Button type="button" variant="ghost" onClick={auth.cancel}>
            Cancel sign-in
          </Button>
        )}
      </div>
      {auth.pendingDeviceCode && (
        <div className="space-y-2">
          <p>Enter this code on the verification page:</p>
          <code className="select-all font-mono text-lg">
            {auth.pendingDeviceCode.userCode}
          </code>
          <a
            className="block underline"
            href={auth.pendingDeviceCode.verificationUri}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open verification page
          </a>
        </div>
      )}
      {auth.isPending && (
        <p className="text-muted-foreground">
          Complete sign-in in the opened tab, then return here.
        </p>
      )}
      {!serverUrl && (
        <p className="text-muted-foreground">Waiting for the Pane server…</p>
      )}
      {auth.error && (
        <p role="alert" className="text-destructive">
          {auth.error}
        </p>
      )}
    </div>
  )
}
