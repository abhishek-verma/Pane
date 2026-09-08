import { expect, it } from 'bun:test'
import type { GateContext } from '@browseros/shared/trust/consequence-class'
import {
  addConversationPin,
  getConversationContext,
  getConversationPins,
  setConversationContext,
} from '../../src/agent/conversation-context-store'
import { runWithProfile } from '../../src/lib/profile-context'

it('shares live policy with MCP, but never across browser profiles', () => {
  const gate: GateContext = {
    pins: {},
    runConsequentialCount: { count: 0 },
    isNewUser: true,
    surface: 'loop',
  }
  runWithProfile('11111111-1111-4111-8111-111111111111', () => {
    setConversationContext('same-id', gate, {
      bucketId: 'workspace-a',
      isScheduledTask: true,
    })
    addConversationPin('same-id', 'system')
    expect(gate.pins.system).toEqual({ pinned: true })
    expect(getConversationContext('same-id')?.tools?.bucketId).toBe(
      'workspace-a',
    )
  })
  runWithProfile('22222222-2222-4222-8222-222222222222', () => {
    expect(getConversationPins('same-id')).toEqual({})
    expect(getConversationContext('same-id')).toBeUndefined()
  })
})
