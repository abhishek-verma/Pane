import { Button } from '@/components/ui/button'

export function ProviderModelCatalogStatus({
  catalog,
}: {
  catalog: {
    canRefresh: boolean
    isFetching: boolean
    isError: boolean
    refetch: () => unknown
  }
}) {
  return (
    <div className="text-muted-foreground text-sm">
      <p>
        Search or enter a model ID. Suggested models do not guarantee account
        access; use Test to check the connection.
      </p>
      {catalog.canRefresh && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={catalog.isFetching}
          onClick={() => catalog.refetch()}
        >
          {catalog.isFetching ? 'Refreshing models…' : 'Refresh models'}
        </Button>
      )}
      {catalog.isError && (
        <p>
          Model refresh failed. Saved suggestions and manual entry are still
          available.
        </p>
      )}
    </div>
  )
}
