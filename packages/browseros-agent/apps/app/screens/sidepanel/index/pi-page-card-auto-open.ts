/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * When the agent's pi_open result auto-navigates the user to a tab, the
 * side panel should follow with the SAME conversation active — otherwise
 * the user loses the thread of what just happened. Only for a real tab
 * switch (openPiHref returns null for in-place hash navigation, nothing to
 * follow), and only for the specific conversation that triggered it —
 * never ambient/global state, so parallel conversations can't steal each
 * other's panel. See EntityPage.tsx / pi-actions.ts for the same
 * conversationId-handoff mechanism used from a manual click.
 */

import { openSidePanelWithSearch } from '@/lib/messaging/sidepanel/openSidepanelWithSearch'
import { openPiHref } from '@/lib/personal-internet/open-pi-href'

export async function autoOpenPiPageAndFollowPanel(
  href: string,
  conversationId: string | null,
): Promise<void> {
  const target = await openPiHref(href)
  if (!target || !conversationId) return
  await openSidePanelWithSearch('open', {
    requestId: crypto.randomUUID(),
    query: '',
    mode: 'agent',
    conversationId,
  })
}
