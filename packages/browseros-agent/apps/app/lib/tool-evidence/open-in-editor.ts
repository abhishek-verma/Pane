/** Resolve a workspace-relative path to an absolute filesystem path. */
export function resolveEditorPath(
  filePath: string,
  workspaceRoot?: string | null,
): string | null {
  if (!filePath || filePath === '(unknown path)') return null
  if (filePath.startsWith('/')) return filePath
  if (!workspaceRoot) return null
  const root = workspaceRoot.replace(/\/+$/, '')
  const rel = filePath.replace(/^\/+/, '')
  return `${root}/${rel}`
}

/** Best-effort open via Cursor then VS Code URI handlers. */
export function openInEditor(
  filePath: string,
  workspaceRoot?: string | null,
): boolean {
  const abs = resolveEditorPath(filePath, workspaceRoot)
  if (!abs) return false
  // Both handlers accept vscode://file/<abs> / cursor://file/<abs>
  window.open(`cursor://file${abs}`, '_blank')
  window.open(`vscode://file${abs}`, '_blank')
  return true
}
