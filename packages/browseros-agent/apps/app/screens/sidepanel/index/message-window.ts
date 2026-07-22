/** Initial number of newest messages rendered. */
export const MESSAGE_WINDOW_SIZE = 30
/** How many older messages to reveal when the top sentinel intersects. */
export const MESSAGE_WINDOW_PAGE = 20

export function getMessageWindowSlice(args: {
  total: number
  windowSize: number
}): { hiddenCount: number; startIndex: number } {
  const windowSize = Math.max(0, args.windowSize)
  const hiddenCount = Math.max(0, args.total - windowSize)
  return { hiddenCount, startIndex: hiddenCount }
}

export function growMessageWindow(args: {
  current: number
  total: number
  page?: number
}): number {
  const page = args.page ?? MESSAGE_WINDOW_PAGE
  return Math.min(args.total, args.current + page)
}
