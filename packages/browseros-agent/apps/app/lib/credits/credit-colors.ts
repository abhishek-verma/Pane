const LOW_THRESHOLD = 30

export function getCreditTextColor(credits: number): string {
  if (credits <= 0) return 'text-red-500'
  if (credits <= LOW_THRESHOLD) return 'text-yellow-500'
  return 'text-green-500'
}
