/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Injectable DOM fact collector for meeting tabs.
 * MUST stay dependency-free — Chrome serializes this for executeScript.
 *
 * Caption / attendee patterns follow OSS Meet scrapers (Meet-Note-Taker,
 * TranscripTonic): Captions region + img→name→text; Zoom roster for initials.
 * Meet UI 2026-07 — revisit if breaks.
 */

import type { MeetingDomFacts } from './types'

/** Union of selectors used by mature adapters for call-state / mute / speakers. */
export const MEETING_SELECTOR_ALLOWLIST = [
  '#meeting-client',
  '.meeting-app',
  '#wc-container',
  '#join-btn',
  '.join-meeting',
  '[data-tid="call-hangup"]',
  '[data-qa="huddle_start_button"]',
  '[data-qa="huddle_leave_button"]',
  '[aria-label*="Leave"]',
  '[aria-label*="leave"]',
  '[aria-label*="speaking"]',
  '[aria-label*="Speaking"]',
  '[aria-label*="presenting"]',
  '[data-self-name]',
  '[data-participant-id]',
  '[data-requested-participant-id]',
  '[role="region"][aria-label="Captions"]',
  '[role="region"][aria-label="captions"]',
  '[aria-label="Captions"]',
  '[aria-live="polite"]',
  'button[aria-label="End"]',
  'button[aria-label="End meeting"]',
] as const /**
 * Runs inside the meeting tab. Collects host/url/text + selector/aria facts.
 * No imports from outer scope beyond what is inlined when serialized.
 */
export function collectMeetingDomFactsPage(): {
  hostname: string
  href: string
  bodyText: string
  pageTitle: string
  facts: MeetingDomFacts
} {
  const hostname = location.hostname.toLowerCase()
  const href = location.href
  const bodyText = document.body?.innerText?.slice(0, 12_000) ?? ''
  const pageTitle = document.title ?? ''

  const selectors = [
    '#meeting-client',
    '.meeting-app',
    '#wc-container',
    '#join-btn',
    '.join-meeting',
    '[data-tid="call-hangup"]',
    '[data-qa="huddle_start_button"]',
    '[data-qa="huddle_leave_button"]',
    '[aria-label*="Leave"]',
    '[aria-label*="leave"]',
    '[aria-label*="speaking"]',
    '[aria-label*="Speaking"]',
    '[aria-label*="presenting"]',
    '[data-self-name]',
    '[data-participant-id]',
    '[role="region"][aria-label="Captions"]',
    '[role="region"][aria-label="captions"]',
    '[aria-label="Captions"]',
    '[aria-live="polite"]',
    'button[aria-label="End"]',
    'button[aria-label="End meeting"]',
  ]

  const matchedSelectors: string[] = []
  for (const sel of selectors) {
    try {
      if (document.querySelector(sel)) matchedSelectors.push(sel)
    } catch {
      /* invalid selector */
    }
  }

  const ariaLabels: string[] = []
  const ariaEls = Array.from(document.querySelectorAll('[aria-label]')).slice(
    0,
    80,
  )
  for (const el of ariaEls) {
    const label = (el.getAttribute('aria-label') ?? '').trim()
    if (label && label.length < 200) ariaLabels.push(label)
  }

  const speakingCandidates: MeetingDomFacts['speakingCandidates'] = []
  const pushCandidate = (name: string, signals: string[]) => {
    const trimmed = name.replace(/\s+/g, ' ').trim()
    if (!trimmed || trimmed.length > 80) return
    speakingCandidates.push({ name: trimmed, signals })
  }

  for (const label of ariaLabels) {
    const lower = label.toLowerCase()
    if (lower.includes('speaking') || lower.includes('presenting')) {
      const name = label
        .replace(/\bis speaking\b/i, '')
        .replace(/\bspeaking:?\s*/i, '')
        .replace(/\bis presenting\b/i, '')
        .replace(/\bpresenting:?\s*/i, '')
        .replace(/[()]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      // Never fall back to the full aria sentence as a display name.
      if (!name || name.length < 2 || name.length > 48) continue
      if (name.split(/\s+/).length > 5) continue
      const signals = ['aria-speaking']
      if (lower.includes('presenting')) signals.push('presenting')
      if (/\byou\b/i.test(label)) signals.push('self')
      pushCandidate(name, signals)
    }
  }

  for (const el of Array.from(
    document.querySelectorAll('[data-self-name]'),
  ).slice(0, 5)) {
    const name = (el.getAttribute('data-self-name') ?? '').trim()
    if (name) pushCandidate(name, ['self'])
  }

  const highlightSel =
    '[class*="speaking"], [class*="Speaking"], [class*="active-speaker"], [class*="activeSpeaker"]'
  try {
    for (const el of Array.from(document.querySelectorAll(highlightSel)).slice(
      0,
      10,
    )) {
      const label =
        el.getAttribute('aria-label') ||
        el.getAttribute('data-participant-name') ||
        (el as HTMLElement).innerText?.split('\n')[0] ||
        ''
      if (label.trim()) {
        pushCandidate(label.trim().slice(0, 80), [
          'border-active',
          'highlighted',
        ])
      }
    }
  } catch {
    /* ignore */
  }

  // --- Captions region (OSS pattern: speaker bound to caption text) ---
  const captionRows: NonNullable<MeetingDomFacts['captionRows']> = []
  const captionRoots: Element[] = []
  try {
    const meetCaptions = document.querySelector(
      '[role="region"][aria-label="Captions"], [role="region"][aria-label="captions"], [aria-label="Captions"]',
    )
    if (meetCaptions) captionRoots.push(meetCaptions)
    for (const live of Array.from(
      document.querySelectorAll('[aria-live="polite"]'),
    ).slice(0, 6)) {
      const len = (live.textContent ?? '').length
      if (len > 0 && len < 4_000 && !captionRoots.includes(live)) {
        captionRoots.push(live)
      }
    }
  } catch {
    /* ignore */
  }

  const pushCaption = (speaker: string, text: string) => {
    const s = speaker
      .replace(/\s+/g, ' ')
      .replace(/\((you|me)\)/gi, '')
      .trim()
    const t = text.replace(/\s+/g, ' ').trim()
    if (
      !s ||
      s.length > 48 ||
      s.split(/\s+/).length > 5 ||
      !t ||
      t.length < 1
    ) {
      return
    }
    if (/^(captions?|transcript|live captions?|participant)$/i.test(s)) return
    // Avoid duplicate consecutive rows (Meet redraws the same CC line often).
    const last = captionRows[captionRows.length - 1]
    if (last && last.speaker === s && last.text === t.slice(0, 280)) return
    captionRows.push({ speaker: s, text: t.slice(0, 280) })
    pushCandidate(s, ['caption-row'])
  }

  for (const root of captionRoots.slice(0, 4)) {
    try {
      const imgs = Array.from(root.querySelectorAll('img')).slice(0, 16)
      for (const img of imgs) {
        const speakerDiv = img.nextElementSibling
        const speaker = (speakerDiv?.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim()
        let text = ''
        const afterSpeaker = speakerDiv?.nextElementSibling
        if (afterSpeaker) {
          text = (afterSpeaker.textContent ?? '').trim()
        } else if (img.parentElement?.nextElementSibling) {
          text = (img.parentElement.nextElementSibling.textContent ?? '').trim()
        }
        if (speaker && text) pushCaption(speaker, text)
      }

      // Meet sometimes puts "Name: utterance" in a single accessible node.
      if (captionRows.length === 0) {
        for (const el of Array.from(root.querySelectorAll('div, span')).slice(
          0,
          60,
        )) {
          const raw = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (!raw || raw.length > 400) continue
          const said = raw.match(/^(.{1,48}?):\s+(.{1,280})$/)
          if (said?.[1] && said[2] && !said[1].includes('.')) {
            pushCaption(said[1], said[2])
            continue
          }
          const prev = el.previousElementSibling
          const speaker = (prev?.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (
            speaker &&
            speaker.length < 48 &&
            speaker !== raw &&
            !raw.startsWith(speaker) &&
            speaker.split(/\s+/).length <= 5
          ) {
            pushCaption(speaker, raw)
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  // --- Attendee roster (Zoom / Meet participant tiles) ---
  const attendees: NonNullable<MeetingDomFacts['attendees']> = []
  const seenAttendee = new Set<string>()
  const pushAttendee = (
    displayName: string,
    opts?: { initials?: string; isLocalSelf?: boolean },
  ) => {
    const name = displayName.replace(/\s+/g, ' ').trim()
    if (!name || name.length > 80 || seenAttendee.has(name.toLowerCase()))
      return
    if (/^(participant|you|me)$/i.test(name) && !opts?.isLocalSelf) return
    seenAttendee.add(name.toLowerCase())
    const initials =
      opts?.initials ||
      name
        .split(/\s+/)
        .filter(Boolean)
        .map((p) => p[0] ?? '')
        .join('')
        .toUpperCase()
        .slice(0, 4)
    attendees.push({
      displayName: name,
      initials,
      isLocalSelf: opts?.isLocalSelf,
    })
  }

  try {
    for (const el of Array.from(
      document.querySelectorAll(
        '[data-participant-id], [data-participant-name], [data-self-name]',
      ),
    ).slice(0, 40)) {
      const selfAttr = el.getAttribute('data-self-name')
      if (selfAttr) {
        pushAttendee(selfAttr, { isLocalSelf: true })
        continue
      }
      const named =
        el.getAttribute('data-participant-name') ||
        el.getAttribute('aria-label') ||
        (el as HTMLElement).innerText?.split('\n')[0] ||
        ''
      if (named.trim()) pushAttendee(named.trim())
    }

    // Zoom-style: aria-labels that look like "Ada Verma" on participant buttons
    for (const label of ariaLabels) {
      if (
        /^(mute|unmute|more|leave|chat|react|view|stop|start|share)/i.test(
          label,
        )
      ) {
        continue
      }
      if (
        label.split(/\s+/).length >= 2 &&
        label.length < 60 &&
        !label.toLowerCase().includes('speaking')
      ) {
        pushAttendee(label)
      }
    }
  } catch {
    /* ignore */
  }

  let selfName: string | undefined
  const selfEl = document.querySelector('[data-self-name]')
  if (selfEl) {
    selfName = (selfEl.getAttribute('data-self-name') ?? '').trim() || undefined
  }
  if (!selfName) {
    for (const label of ariaLabels) {
      if (/\byou\b/i.test(label) && label.length < 60) {
        selfName = label.replace(/\byou\b/i, '').trim() || 'You'
        break
      }
    }
  }
  if (selfName) pushAttendee(selfName, { isLocalSelf: true })

  const isVisible = (el: Element): boolean => {
    try {
      const html = el as HTMLElement
      const style = window.getComputedStyle(html)
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0'
      ) {
        return false
      }
      const rect = html.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    } catch {
      return false
    }
  }

  let hasVisibleLeaveControl = false
  let hasVisibleJoinControl = false
  let hasVisibleMuteControl = false
  try {
    for (const el of Array.from(
      document.querySelectorAll('[aria-label]'),
    ).slice(0, 120)) {
      if (!isVisible(el)) continue
      const label = (el.getAttribute('aria-label') ?? '').toLowerCase().trim()

      // Leave / end: any visible button that ends your participation.
      // Matches: "Leave", "Leave call", "Leave meeting", "End", "End call",
      // "End meeting", "End for all", "Hang up", "Disconnect", etc.
      if (
        label === 'leave' ||
        label === 'end' ||
        label === 'hang up' ||
        label === 'disconnect' ||
        label.startsWith('leave ') ||
        label.startsWith('end ') ||
        label.includes('leave call') ||
        label.includes('leave meeting') ||
        label.includes('end call') ||
        label.includes('end meeting') ||
        label.includes('hang up') ||
        label.includes('disconnect')
      ) {
        hasVisibleLeaveControl = true
      }

      // Join: any visible button that puts you into the call.
      if (
        label === 'join' ||
        label.includes('join now') ||
        label.includes('ask to join') ||
        label.startsWith('join ')
      ) {
        hasVisibleJoinControl = true
      }

      // Mute / unmute: present in every call UI; never on pre-join screens.
      // Accessibility-critical — platforms must label these for screen readers.
      if (
        label === 'mute' ||
        label === 'unmute' ||
        label.startsWith('mute ') ||
        label.startsWith('unmute ') ||
        label.includes(' mute') ||
        label.includes(' unmute')
      ) {
        hasVisibleMuteControl = true
      }
    }

    // Broader selector checks for platforms that use data attributes
    // instead of aria-labels for their call controls.
    for (const [sel, kind] of [
      ['[data-tid="call-hangup"]', 'leave'],
      ['[data-qa="huddle_leave_button"]', 'leave'],
      ['button[aria-label*="Leave" i]', 'leave'],
      ['button[aria-label*="End" i]', 'leave'],
      ['button[aria-label*="Hang up" i]', 'leave'],
      ['button[aria-label*="Mute" i]', 'mute'],
      ['button[aria-label*="Unmute" i]', 'mute'],
    ] as const) {
      try {
        const el = document.querySelector(sel)
        if (el && isVisible(el)) {
          if (kind === 'leave') hasVisibleLeaveControl = true
          if (kind === 'mute') hasVisibleMuteControl = true
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  return {
    hostname,
    href,
    bodyText,
    pageTitle,
    facts: {
      matchedSelectors,
      ariaLabels: ariaLabels.slice(0, 60),
      speakingCandidates: speakingCandidates.slice(0, 30),
      selfName,
      captionRows: captionRows.slice(-8),
      attendees: attendees.slice(0, 40),
      hasVisibleLeaveControl,
      hasVisibleJoinControl,
      hasVisibleMuteControl,
    },
  }
}
