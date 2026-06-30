/**
 * Workspace scope for filesystem and terminal tools.
 */

export interface TerminalPolicy {
  /** Substrings blocked in shell commands (case-insensitive match). */
  denylist: string[]
  /** When set, only commands matching one of these substrings are allowed. */
  allowlist?: string[]
}

export interface Workspace {
  root: string
  scope: 'read' | 'write'
  terminalPolicy: TerminalPolicy
  bucketId: string
}

/**
 * Conservative terminal denylist. Each entry blocks commands containing the
 * substring (case-insensitive):
 * - `rm -rf /` — recursive delete of filesystem root
 * - `sudo ` — privilege escalation (trailing space avoids `sudoers` false positives)
 * - `mkfs` — format disks
 * - `dd if=` — raw disk writes
 * - `shutdown` / `reboot` — system power control
 * - `:(){ :|:&` — fork bomb
 *
 * `curl` / `wget` are intentionally omitted — the browser can fetch URLs anyway.
 */
export const DEFAULT_TERMINAL_DENYLIST = [
  'rm -rf /',
  'sudo ',
  'mkfs',
  'dd if=',
  'shutdown',
  'reboot',
  ':(){ :|:&',
] as const

export function defaultWorkspace(
  root: string,
  overrides?: Partial<Workspace>,
): Workspace {
  return {
    root,
    scope: 'write',
    terminalPolicy: { denylist: [...DEFAULT_TERMINAL_DENYLIST] },
    bucketId: 'default',
    ...overrides,
  }
}

export function isDenied(
  command: string,
  policy: TerminalPolicy,
): { denied: true; reason: string } | { denied: false } {
  const normalized = command.toLowerCase()

  if (policy.allowlist?.length) {
    const allowed = policy.allowlist.some((entry) =>
      normalized.includes(entry.toLowerCase()),
    )
    if (!allowed) {
      return { denied: true, reason: 'command not on allowlist' }
    }
  }

  for (const entry of policy.denylist) {
    if (normalized.includes(entry.toLowerCase())) {
      return { denied: true, reason: `matched denylist entry: ${entry}` }
    }
  }

  return { denied: false }
}
