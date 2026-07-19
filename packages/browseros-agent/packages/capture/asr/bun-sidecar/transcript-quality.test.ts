import { describe, expect, test } from 'bun:test'
import {
  cleanTranscriptText,
  decideAsrWindow,
  extractWhisperText,
  MIN_WINDOW_SAMPLES,
  OVERLAP_SAMPLES,
  peakNormalize,
  SAMPLE_RATE,
  stripOverlapDuplicate,
} from './transcript-quality'

describe('cleanTranscriptText', () => {
  test('strips timestamp crumbs and blank tags', () => {
    expect(
      cleanTranscriptText('00:00:00,000 00:00:02,000 This is a test.'),
    ).toBe('This is a test.')
    expect(cleanTranscriptText('00:00:00,000 00:00:10,000 [BLANK_AUDIO]')).toBe(
      '',
    )
    expect(cleanTranscriptText('[MUSIC PLAYING]')).toBe('')
    expect(
      cleanTranscriptText('00:-16:-47,-260 This is the test, testing.'),
    ).toBe('This is the test, testing.')
  })
})

describe('stripOverlapDuplicate', () => {
  test('removes repeated leading words from overlap', () => {
    expect(
      stripOverlapDuplicate(
        'working better now but are you able',
        'The quality is working better now',
      ),
    ).toBe('but are you able')
  })
})

describe('decideAsrWindow', () => {
  test('waits for min window unless forced', () => {
    expect(
      decideAsrWindow({
        totalSamples: SAMPLE_RATE * 4,
        lastEndSample: 0,
      }),
    ).toEqual({ run: false })

    const ready = decideAsrWindow({
      totalSamples: MIN_WINDOW_SAMPLES,
      lastEndSample: 0,
    })
    expect(ready).toMatchObject({
      run: true,
      clipStart: 0,
      clipEnd: MIN_WINDOW_SAMPLES,
    })

    const forced = decideAsrWindow({
      totalSamples: SAMPLE_RATE * 2,
      lastEndSample: 0,
      force: true,
    })
    expect(forced).toMatchObject({ run: true })
    if (forced.run) {
      expect(forced.clipStart).toBe(0)
    }
  })

  test('applies overlap against prior end', () => {
    const last = SAMPLE_RATE * 20
    const total = last + MIN_WINDOW_SAMPLES
    const win = decideAsrWindow({ totalSamples: total, lastEndSample: last })
    expect(win).toMatchObject({
      run: true,
      clipStart: last - OVERLAP_SAMPLES,
      clipEnd: total,
    })
  })
})

describe('peakNormalize', () => {
  test('boosts quiet audio toward target peak', () => {
    const quiet = new Float32Array([0.01, -0.02, 0.015])
    const out = peakNormalize(quiet, 0.9)
    let peak = 0
    for (const v of out) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeCloseTo(0.9, 5)
  })
})

describe('extractWhisperText', () => {
  test('reads nested segment objects and drops timestamps', () => {
    const text = extractWhisperText([
      [
        {
          timestamps: { from: '00:00:00,000', to: '00:00:02,000' },
          text: ' Hi',
        },
        '00:00:02,000',
        { text: 'there' },
      ],
    ])
    expect(text).toBe('Hi there')
  })
})
