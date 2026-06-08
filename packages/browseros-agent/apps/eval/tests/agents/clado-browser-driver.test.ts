import { describe, expect, it } from 'bun:test'
import {
  prepareCladoToolArgs,
  prepareCladoToolCall,
  resolveCladoPoint,
} from '../../src/agents/orchestrated/backends/clado/clado-browser-driver'

describe('Clado browser driver helpers', () => {
  it('maps normalized coordinates into the current viewport', () => {
    expect(resolveCladoPoint({ width: 1440, height: 900 }, 500, 500)).toEqual({
      x: 720,
      y: 450,
    })
  })

  it('clamps normalized coordinates before mapping to pixels', () => {
    expect(resolveCladoPoint({ width: 1000, height: 800 }, -10, 1200)).toEqual({
      x: 0,
      y: 799,
    })
  })

  it('keeps the current evaluate_script argument conversion', () => {
    expect(
      prepareCladoToolArgs(
        'evaluate_script',
        { function: '() => window.location.href' },
        7,
      ),
    ).toEqual({
      expression: '(() => window.location.href)()',
      page: 7,
    })
  })

  it('normalizes click_at and adds page for page-scoped tools', () => {
    expect(
      prepareCladoToolArgs('click_at', { x: 10, y: 20, dblClick: true }, 3),
    ).toEqual({
      x: 10,
      y: 20,
      clickCount: 2,
      page: 3,
    })
  })

  it('omits wait value for time-based wait_for calls', () => {
    expect(prepareCladoToolCall('wait_for', { timeout: 2500 }, 9)).toEqual({
      toolName: 'wait',
      args: {
        page: 9,
        for: 'time',
        timeout: 2500,
      },
    })
  })

  it('keeps selector value for selector-based wait_for calls', () => {
    expect(
      prepareCladoToolCall(
        'wait_for',
        { selector: '#ready', timeout: 2500 },
        9,
      ),
    ).toEqual({
      toolName: 'wait',
      args: {
        page: 9,
        for: 'selector',
        value: '#ready',
        timeout: 2500,
      },
    })
  })
})
