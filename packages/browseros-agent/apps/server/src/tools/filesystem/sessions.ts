import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getSessionsDir } from '../../lib/browseros-dir'
import { isPathInside, resolveWorkspaceRoot } from './path-boundary'
import type { Workspace } from './workspace'

export interface TerminalSessionRecord {
  id: string
  name: string
  cwd: string
  createdAt: number
}

export interface TerminalSessionEvent {
  workspaceKey: string
  bucketId: string
  session: TerminalSessionRecord
  command: string
  exitCode: number
}

type TerminalSessionListener = (event: TerminalSessionEvent) => void

const listeners = new Set<TerminalSessionListener>()

export function onTerminalSession(
  listener: TerminalSessionListener,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emitTerminalSession(event: TerminalSessionEvent): void {
  for (const listener of listeners) {
    listener(event)
  }
}

function workspaceKey(workspace: Workspace): string {
  return workspace.workspaceId ?? workspace.bucketId
}

function sessionsRoot(workspace: Workspace): string {
  return join(getSessionsDir(), workspaceKey(workspace))
}

function sessionFilePath(workspace: Workspace, sessionId: string): string {
  return join(sessionsRoot(workspace), `${sessionId}.json`)
}

async function readSession(
  workspace: Workspace,
  sessionId: string,
): Promise<TerminalSessionRecord | null> {
  try {
    const raw = await readFile(sessionFilePath(workspace, sessionId), 'utf-8')
    return JSON.parse(raw) as TerminalSessionRecord
  } catch {
    return null
  }
}

async function writeSession(
  workspace: Workspace,
  session: TerminalSessionRecord,
): Promise<void> {
  const dir = sessionsRoot(workspace)
  await mkdir(dir, { recursive: true })
  await writeFile(
    sessionFilePath(workspace, session.id),
    JSON.stringify(session),
    {
      encoding: 'utf-8',
    },
  )
}

export async function openTerminalSession(
  workspace: Workspace,
  name?: string,
): Promise<TerminalSessionRecord> {
  const root = await resolveWorkspaceRoot(workspace.root)
  const session: TerminalSessionRecord = {
    id: crypto.randomUUID(),
    name: name?.trim() || 'default',
    cwd: root,
    createdAt: Date.now(),
  }
  await writeSession(workspace, session)
  return session
}

export async function listTerminalSessions(
  workspace: Workspace,
): Promise<TerminalSessionRecord[]> {
  const dir = sessionsRoot(workspace)
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }

  const sessions: TerminalSessionRecord[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const id = file.replace(/\.json$/, '')
    const session = await readSession(workspace, id)
    if (session) sessions.push(session)
  }
  return sessions.sort((a, b) => b.createdAt - a.createdAt)
}

export async function readSessionForBash(
  workspace: Workspace,
  sessionId: string,
): Promise<TerminalSessionRecord | null> {
  return readSession(workspace, sessionId)
}

export async function getTerminalSessionCwd(
  workspace: Workspace,
  sessionId: string,
): Promise<string | null> {
  const session = await readSession(workspace, sessionId)
  return session?.cwd ?? null
}

export async function updateTerminalSessionCwd(
  workspace: Workspace,
  sessionId: string,
  cwd: string,
): Promise<void> {
  const session = await readSession(workspace, sessionId)
  if (!session) return
  await writeSession(workspace, { ...session, cwd })
}

export async function closeTerminalSession(
  workspace: Workspace,
  sessionId: string,
): Promise<boolean> {
  try {
    const { unlink } = await import('node:fs/promises')
    await unlink(sessionFilePath(workspace, sessionId))
    return true
  } catch {
    return false
  }
}

/** Resolves cwd after a `cd` command, keeping it inside the workspace root. */
export async function resolveSessionCd(
  workspace: Workspace,
  currentCwd: string,
  command: string,
): Promise<string> {
  const trimmed = command.trim()
  const match = /^cd(?:\s+(.+))?$/s.exec(trimmed)
  if (!match) return currentCwd

  const root = await resolveWorkspaceRoot(workspace.root)
  const cwd = await realpath(currentCwd).catch(() => resolve(currentCwd))
  const arg = match[1]?.trim()
  if (!arg) return root

  const unquoted = arg.replace(/^['"]|['"]$/g, '')
  const candidate = unquoted.startsWith('/')
    ? resolve(unquoted)
    : resolve(cwd, unquoted)

  if (!isPathInside(root, candidate)) {
    return cwd
  }
  return candidate
}

export function notifyTerminalSessionRun(
  workspace: Workspace,
  session: TerminalSessionRecord,
  command: string,
  exitCode: number,
): void {
  emitTerminalSession({
    workspaceKey: workspaceKey(workspace),
    bucketId: workspace.bucketId,
    session,
    command,
    exitCode,
  })
}
