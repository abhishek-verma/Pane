import { describe, expect, test } from 'bun:test'
import { buildAppSendDetail } from './app-send-evidence'

describe('buildAppSendDetail', () => {
  test('execute_action uses server · action', () => {
    const d = buildAppSendDetail({
      toolName: 'execute_action',
      input: {
        server_name: 'gmail',
        action_name: 'send_email',
        to: 'a@b.com',
      },
      outputText: 'queued',
    })
    expect(d.title).toBe('gmail · send_email')
    expect(d.destination).toBe('a@b.com')
    expect(d.summary).toBe('queued')
  })

  test('falls back to prettified tool name', () => {
    const d = buildAppSendDetail({
      toolName: 'slack_send_message',
      input: {},
      outputText: '',
    })
    expect(d.title).toBe('Slack send message')
  })
})
