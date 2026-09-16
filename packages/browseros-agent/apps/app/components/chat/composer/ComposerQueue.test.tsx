import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { emptyComposer } from '@/modules/chat/composer-store'
import type { ChatComposerController } from '@/modules/chat/use-chat-composer'
import { ComposerQueue } from './ComposerQueue'

const render = (queue: ChatComposerController['state']['queue']) =>
  renderToStaticMarkup(
    <ComposerQueue
      composer={
        { state: { ...emptyComposer(), queue } } as ChatComposerController
      }
    />,
  )
describe('upcoming messages', () => {
  it('never labels the active prompt as queued or sending', () => {
    expect(
      render([
        { id: 'active', state: 'sending', message: { text: 'Current task' } },
      ]),
    ).toBe('')
  })
  it('shows follow-ups immediately with editing and removal, without pause controls', () => {
    const html = render([
      { id: 'active', state: 'sending', message: { text: 'Current task' } },
      { id: 'next', state: 'queued', message: { text: 'Next instruction' } },
    ])
    expect(html).toContain('1 queued')
    expect(html).toContain('Next instruction')
    expect(html).toContain('Edit queued message')
    expect(html).toContain('Remove queued message')
    expect(html).not.toContain('Current task')
    expect(html).not.toContain('Pause queue')
    expect(html).not.toContain('Resume queue')
  })
})
