/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Globe } from 'lucide-react'
import { type FC, useState } from 'react'
import { getFavicons } from '@/lib/getFavicons'
import { useContinueSites } from './continue-sites.hooks'

const ContinueSiteIcon: FC<{ src?: string }> = ({ src }) => {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <span
      aria-hidden="true"
      className="relative flex size-4 shrink-0 items-center justify-center"
    >
      {!loaded || failed ? (
        <Globe className="size-4 text-muted-foreground" />
      ) : null}
      {src && !failed ? (
        <img
          src={src}
          alt=""
          className={`absolute inset-0 size-4 object-contain ${loaded ? '' : 'opacity-0'}`}
          onError={() => setFailed(true)}
          onLoad={(event) => {
            const valid =
              event.currentTarget.naturalWidth > 1 &&
              event.currentTarget.naturalHeight > 1
            setLoaded(valid)
            setFailed(!valid)
          }}
        />
      ) : null}
    </span>
  )
}

export const ContinueSites: FC = () => {
  const sites = useContinueSites()
  if (sites.length === 0) return null

  return (
    <section aria-label="Frequently visited sites" className="mt-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {sites.map((site) => {
          const icon = site.host ? getFavicons(site.host) : undefined
          return (
            <a
              key={site.url}
              href={site.url}
              className="flex items-center gap-2 py-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
            >
              <ContinueSiteIcon key={icon ?? site.url} src={icon} />
              <span className="max-w-32 truncate">{site.name}</span>
            </a>
          )
        })}
      </div>
    </section>
  )
}
