/** Prefetch buffer so thumbs mount slightly before they enter the viewport. */
export const THUMB_ROOT_MARGIN = '200px 0px 200px 0px'

/**
 * Whether a browser-action card should mount its `<img>` (decode bitmap).
 * Offscreen cards keep a reserved box but drop the decoded image.
 */
export function shouldMountBrowserThumb(args: {
  nearViewport: boolean
  highlighted: boolean
  hasImageSource: boolean
  showBrowserScreenshots: boolean
  imageFailed: boolean
}): boolean {
  const showSlot =
    args.hasImageSource && args.showBrowserScreenshots && !args.imageFailed
  if (!showSlot) return false
  return args.nearViewport || args.highlighted
}
