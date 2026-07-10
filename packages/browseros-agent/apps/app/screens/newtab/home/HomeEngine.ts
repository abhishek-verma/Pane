/**
 * Pure ranking helpers for adaptive home (unit-tested without network).
 */

export type HomeWidgetType =
  | 'daily-digest'
  | 'pending-approvals'
  | 'resumed-work'
  | 'one-click-recurring'
  | 'recent-sites-fallback'

export interface HomeWidget {
  type: HomeWidgetType
  title: string
  why: string
  rank: number
  pinned?: boolean
}

export interface HomePrefs {
  pinned: HomeWidgetType[]
  hidden: HomeWidgetType[]
  dismissed: HomeWidgetType[]
}

export function parseHomePrefs(userMd: string): HomePrefs {
  const pinned: HomeWidgetType[] = []
  const hidden: HomeWidgetType[] = []
  const dismissed: HomeWidgetType[] = []
  for (const m of userMd.matchAll(/home\.pin:\s*(\S+)/gi)) {
    pinned.push(m[1] as HomeWidgetType)
  }
  for (const m of userMd.matchAll(/home\.hide:\s*(\S+)/gi)) {
    hidden.push(m[1] as HomeWidgetType)
  }
  for (const m of userMd.matchAll(/home\.dismiss:\s*(\S+)/gi)) {
    dismissed.push(m[1] as HomeWidgetType)
  }
  return { pinned, hidden, dismissed }
}

export function appendHomePrefLine(
  userMd: string,
  kind: 'pin' | 'hide' | 'dismiss',
  widget: HomeWidgetType,
): string {
  const line = `home.${kind}: ${widget}`
  if (userMd.includes(line)) return userMd
  return `${userMd.trimEnd()}\n- ${line}\n`
}

export function rankWidgets(
  candidates: HomeWidget[],
  prefs: HomePrefs,
): HomeWidget[] {
  const blocked = new Set([...prefs.hidden, ...prefs.dismissed])
  const pinned = new Set(prefs.pinned)
  return candidates
    .filter((w) => !blocked.has(w.type))
    .map((w) => ({ ...w, pinned: pinned.has(w.type) }))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (a.rank !== b.rank) return a.rank - b.rank
      return a.type.localeCompare(b.type)
    })
}
