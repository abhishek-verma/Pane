import { useQuery } from '@tanstack/react-query'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'

export interface WorkspaceBrowseEntry {
  name: string
  type: 'dir' | 'file'
  size?: number
}

export interface WorkspaceBrowseResult {
  path: string
  entries: WorkspaceBrowseEntry[]
}

const WORKSPACE_FILES_QUERY_KEY = 'workspace-files'

async function fetchWorkspaceFiles(
  baseUrl: string,
  root: string,
  path: string,
): Promise<WorkspaceBrowseResult> {
  const params = new URLSearchParams({ root, path })
  const res = await fetch(
    `${baseUrl.replace(/\/$/, '')}/workspace/files?${params}`,
  )
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Failed to browse workspace (${res.status})`)
  }
  return res.json() as Promise<WorkspaceBrowseResult>
}

async function fetchWorkspaceFile(
  baseUrl: string,
  root: string,
  path: string,
): Promise<{ path: string; content: string }> {
  const params = new URLSearchParams({ root, path })
  const res = await fetch(
    `${baseUrl.replace(/\/$/, '')}/workspace/file?${params}`,
  )
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Failed to read file (${res.status})`)
  }
  return res.json() as Promise<{ path: string; content: string }>
}

export function useWorkspaceFiles(root: string | undefined, path = '.') {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()

  const query = useQuery({
    queryKey: [WORKSPACE_FILES_QUERY_KEY, baseUrl, root, path],
    queryFn: () => fetchWorkspaceFiles(baseUrl as string, root as string, path),
    enabled: Boolean(baseUrl && root) && !urlLoading,
  })

  return {
    entries: query.data?.entries ?? [],
    currentPath: query.data?.path ?? path,
    loading: query.isLoading || urlLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

export function useWorkspaceFileContent(
  root: string | undefined,
  filePath: string | undefined,
) {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()

  const query = useQuery({
    queryKey: [WORKSPACE_FILES_QUERY_KEY, 'file', baseUrl, root, filePath],
    queryFn: () =>
      fetchWorkspaceFile(baseUrl as string, root as string, filePath as string),
    enabled: Boolean(baseUrl && root && filePath) && !urlLoading,
  })

  return {
    content: query.data?.content,
    loading: query.isLoading || urlLoading,
    error: query.error,
  }
}
