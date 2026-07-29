/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { tool } from 'ai'
import { z } from 'zod'
import {
  CHAT_MODE_ALLOWED_NON_BROWSER_TOOLS,
  filterToolsForChatMode,
  isChatModeToolAllowed,
} from '../../src/agent/chat-mode'

const stub = tool({
  description: 'stub',
  inputSchema: z.object({}),
  execute: async () => ({ text: 'ok' }),
})

describe('chat mode tool allowlist', () => {
  it('allows read capture/context/skills/home surfaces', () => {
    for (const name of [
      'capture_list',
      'capture_read',
      'capture_status',
      'context_search',
      'context_current_work',
      'tasks_list',
      'skills_list',
      'skills_load',
      'home_widget_list',
      'filesystem_read',
      'pi_list',
      'pi_read',
      'pi_pulse_get',
    ]) {
      expect(isChatModeToolAllowed(name)).toBe(true)
      expect(CHAT_MODE_ALLOWED_NON_BROWSER_TOOLS.has(name)).toBe(true)
    }
  })

  it('denies mutating local tools', () => {
    for (const name of [
      'memory_add',
      'memory_replace',
      'memory_remove',
      'tasks_add',
      'tasks_done',
      'home_widget_add',
      'home_widget_remove',
      'home_widget_propose',
      'skills_install',
      'skills_archive',
      'capture_start',
      'capture_stop',
      'suggest_schedule',
      'filesystem_bash',
      'filesystem_write',
      'act',
      'pi_site_upsert',
      'pi_page_create',
      'pi_page_patch',
      'pi_home_regions_patch',
    ]) {
      expect(isChatModeToolAllowed(name)).toBe(false)
    }
  })

  it('filters a merged tool set down to allowlisted names only', () => {
    const filtered = filterToolsForChatMode({
      capture_list: stub,
      capture_start: stub,
      memory_add: stub,
      context_search: stub,
      skills_install: stub,
      skills_load: stub,
      act: stub,
      snapshot: stub,
    })
    expect(Object.keys(filtered).sort()).toEqual(
      ['capture_list', 'context_search', 'skills_load', 'snapshot'].sort(),
    )
  })
})
