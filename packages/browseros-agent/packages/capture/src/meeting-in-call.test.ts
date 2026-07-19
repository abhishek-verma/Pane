/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { evaluateMeetingCallState } from './meeting-in-call'

function probe(input: {
  hostname?: string
  bodyText?: string
  title?: string
  selectors?: string[]
  ariaLabels?: string[]
}) {
  const selectors = new Set(input.selectors ?? [])
  const ariaLabels = input.ariaLabels ?? []
  const probeInput = {
    hostname: input.hostname ?? 'meet.google.com',
    bodyText: input.bodyText ?? '',
    pageTitle: input.title,
    matchesSelector: (selector: string) => selectors.has(selector),
    ariaLabelIncludes: (text: string) =>
      ariaLabels.some((label) =>
        label.toLowerCase().includes(text.toLowerCase()),
      ),
  }
  return evaluateMeetingCallState(probeInput)
}

describe('@browseros/capture meeting-in-call', () => {
  it('returns prejoin on Google Meet join screen', () => {
    expect(
      probe({
        bodyText: 'Join now\nGetting ready to join',
      }),
    ).toBe('prejoin')
  })

  it('returns prejoin on room URL without in-call signals', () => {
    expect(
      probe({
        bodyText: 'Meet - standup\nSome participants',
      }),
    ).toBe('prejoin')
  })

  it('returns in-call when call timer is visible', () => {
    expect(
      probe({
        bodyText: 'Alice\nBob\n12:34',
      }),
    ).toBe('in-call')
  })

  it('returns left after leaving the meeting', () => {
    expect(
      probe({
        bodyText: 'You left the meeting\nRejoin\nReturn to home screen',
      }),
    ).toBe('left')
  })

  it('returns unknown for unclear Slack huddle DOM', () => {
    expect(
      probe({
        hostname: 'app.slack.com',
        bodyText: 'channel messages unrelated',
      }),
    ).toBe('unknown')
  })

  it('returns in-call for Slack leave huddle control', () => {
    expect(
      probe({
        hostname: 'app.slack.com',
        bodyText: 'Leave huddle',
        ariaLabels: ['Leave huddle'],
      }),
    ).toBe('in-call')
  })
})
