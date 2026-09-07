/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Globe } from 'lucide-react'
import { type FC, useState } from 'react'
import { getFavicons } from '@/lib/getFavicons'
import { useContinueSites } from './continue-sites.hooks'

const ContinueSiteIcon: FC<{ src: string; alt: string }> = ({ src, alt }) => {
  const [failed, setFailed] = useState(false)

  if (failed) return <Globe className="h-4 w-4 text-muted-foreground" />

  return (
    <img
      src={src}
      alt={alt}
      className="h-4 w-4 object-contain"
      onError={() => setFailed(true)}
      onLoad={(e) => {
        const img = e.currentTarget
        if (img.naturalWidth === 0 || img.naturalHeight === 0) {
          setFailed(true)
        }
      }}
    />
  )
}

export const ContinueSites: FC = () => {
  const sites = useContinueSites()
  if (sites.length === 0) return null

  return (
    <section
      aria-label="Frequently visited sites"
      className="mx-auto w-full max-w-3xl"
    >
      <div className="py-3">
        <h2 className="text-muted-foreground text-xs">Your shortcuts</h2>
      </div>
      <div className="flex flex-wrap gap-2 pb-3">
        {sites.map((site) => {
          const icon = site.host ? getFavicons(site.host) : undefined
          return (
            <a
              key={site.url}
              href={site.url}
              className="flex items-center gap-2 rounded-xl border border-border/60 bg-background px-3 py-2.5 text-sm transition-colors hover:bg-muted/60"
            >
              {icon ? (
                <ContinueSiteIcon src={icon} alt={site.name} />
              ) : (
                <Globe className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="max-w-32 truncate">{site.name}</span>
            </a>
          )
        })}
      </div>
    </section>
  )
}
