import { PRODUCT_NAME } from '@/lib/constants/product'

export function piPageTitle(
  pageTitle: string | null | undefined,
  siteName?: string | null,
): string {
  const page = pageTitle?.trim()
  const site = siteName?.trim()
  const parts = page && page !== site ? [page, site] : [site || page]
  return [...parts.filter(Boolean), PRODUCT_NAME].join(' · ')
}

/** Local, stable identity: no external favicon service or network request. */
export function piFavicon(
  seed: string,
  name: string,
  temporary = false,
): string {
  let hash = 0x811c9dc5
  for (const char of seed) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193)
  }
  const hue = (hash >>> 0) % 360
  const words = name.trim().split(/\s+/u).filter(Boolean)
  const initials =
    words
      .slice(0, 2)
      .map((word) => Array.from(word)[0])
      .join('')
      .toLocaleUpperCase() || 'P'
  const escaped = initials.replace(
    /[<>&"']/g,
    (char) => `&#${char.charCodeAt(0)};`,
  )
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="hsl(${hue},55%,36%)"/><text x="16" y="22" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" font-weight="700" fill="white">${escaped}</text>${temporary ? '<path d="M23 0h2a7 7 0 0 1 7 7v2z" fill="white" fill-opacity=".8"/>' : ''}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export function setPageMetadata(
  title: string,
  favicon = typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL('icon/32.png')
    : '/icon/32.png',
): void {
  document.title = title
  // Keep one authoritative icon. Competing sizes/static fallback links can
  // otherwise make Chromium keep showing the Pane logo after navigation.
  const icons = document.head.querySelectorAll<HTMLLinkElement>(
    'link[rel~="icon"], link[rel="apple-touch-icon"]',
  )
  let icon = icons[0]
  for (const duplicate of Array.from(icons).slice(1)) duplicate.remove()
  if (!icon) {
    icon = document.createElement('link')
    document.head.appendChild(icon)
  }
  icon.rel = 'icon'
  icon.type = favicon.startsWith('data:image/svg+xml')
    ? 'image/svg+xml'
    : 'image/png'
  icon.removeAttribute('sizes')
  if (icon.getAttribute('href') !== favicon) icon.setAttribute('href', favicon)
}
