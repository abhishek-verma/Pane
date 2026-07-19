/** Build the hash-route URL for the Action Log settings page. */
export function actionLogHref(conversationId?: string): string {
  const query = conversationId
    ? `?conversationId=${encodeURIComponent(conversationId)}`
    : ''
  return `#/settings/action-log${query}`
}

/** Open Action Log in the full app window (works from side panel). */
export function openActionLog(conversationId?: string): void {
  const hash = actionLogHref(conversationId)
  const path = `app.html${hash}`
  const url =
    typeof chrome !== 'undefined' && chrome.runtime?.getURL
      ? chrome.runtime.getURL(path)
      : `/${path}`
  window.open(url, '_blank')
}
