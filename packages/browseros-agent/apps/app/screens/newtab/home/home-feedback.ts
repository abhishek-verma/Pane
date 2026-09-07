/** A queued harvest or skipped job is not a completed refresh. */
export function homeRefreshMessage(payload: {
  refreshed?: Array<{ outcome: string }>
  pending?: number
}): string {
  const outcomes = payload.refreshed?.map((job) => job.outcome) ?? []
  if (
    outcomes.some(
      (outcome) => outcome === 'skipped' || outcome === 'skipped-stale',
    )
  ) {
    return 'Some sources couldn’t update. Showing the latest saved information.'
  }
  if (outcomes.includes('harvested') || (payload.pending ?? 0) > 0) {
    return 'Updates are still running. New information will appear here when ready.'
  }
  return 'Checked your saved work. This view uses information already in Pane.'
}
