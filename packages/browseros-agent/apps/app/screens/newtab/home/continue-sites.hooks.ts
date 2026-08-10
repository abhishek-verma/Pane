import { useEffect, useState } from 'react'
import {
  type ContinueSite,
  mapTopSitesToContinueSites,
} from './continue-sites.helpers'

const MAX_CONTINUE_SITES = 6

export function useContinueSites(): ContinueSite[] {
  const [sites, setSites] = useState<ContinueSite[]>([])

  useEffect(() => {
    // `chrome.topSites` is absent until the `topSites` permission is granted
    // (e.g. before the extension reloads with the restored manifest).
    if (!chrome.topSites) return
    chrome.topSites.get().then((topSites) => {
      setSites(mapTopSitesToContinueSites(topSites, MAX_CONTINUE_SITES))
    })
  }, [])

  return sites
}
