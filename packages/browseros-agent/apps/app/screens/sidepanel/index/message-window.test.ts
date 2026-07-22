import { describe, expect, test } from 'bun:test'
import {
  getMessageWindowSlice,
  growMessageWindow,
  MESSAGE_WINDOW_PAGE,
  MESSAGE_WINDOW_SIZE,
} from './message-window'

describe('message-window', () => {
  test('hides nothing when total fits in the window', () => {
    expect(
      getMessageWindowSlice({ total: 10, windowSize: MESSAGE_WINDOW_SIZE }),
    ).toEqual({ hiddenCount: 0, startIndex: 0 })
  })

  test('hides oldest messages beyond the window', () => {
    expect(
      getMessageWindowSlice({ total: 50, windowSize: MESSAGE_WINDOW_SIZE }),
    ).toEqual({ hiddenCount: 20, startIndex: 20 })
  })

  test('grows by a page without exceeding total', () => {
    expect(
      growMessageWindow({
        current: MESSAGE_WINDOW_SIZE,
        total: 55,
        page: MESSAGE_WINDOW_PAGE,
      }),
    ).toBe(50)
    expect(
      growMessageWindow({
        current: 50,
        total: 55,
        page: MESSAGE_WINDOW_PAGE,
      }),
    ).toBe(55)
  })
})
