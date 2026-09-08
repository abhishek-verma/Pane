import { useEffect } from 'react'
import { setPageMetadata } from './page-metadata'

/** Each route owns its metadata, including its loading and error states. */
export function usePageMetadata(title: string, favicon?: string): void {
  useEffect(() => {
    setPageMetadata(title, favicon)
  }, [title, favicon])
}
