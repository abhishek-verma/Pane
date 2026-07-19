import { storage } from '@wxt-dev/storage'
import { useEffect, useState } from 'react'

/** chrome.storage.local key (via wxt `local:` prefix) */
export const SHOW_BROWSER_SCREENSHOTS_KEY =
  'local:toolEvidence.showBrowserScreenshots'
/** chrome.storage.local key (via wxt `local:` prefix) */
export const BLUR_SCREENSHOTS_UNTIL_CLICK_KEY =
  'local:toolEvidence.blurScreenshotsUntilClick'

export const showBrowserScreenshotsStorage = storage.defineItem<boolean>(
  SHOW_BROWSER_SCREENSHOTS_KEY,
  { fallback: true },
)

export const blurScreenshotsUntilClickStorage = storage.defineItem<boolean>(
  BLUR_SCREENSHOTS_UNTIL_CLICK_KEY,
  { fallback: false },
)

export type ScreenshotPrefs = {
  showBrowserScreenshots: boolean
  blurScreenshotsUntilClick: boolean
  setShowBrowserScreenshots: (value: boolean) => Promise<void>
  setBlurScreenshotsUntilClick: (value: boolean) => Promise<void>
}

export function useScreenshotPrefs(): ScreenshotPrefs {
  const [showBrowserScreenshots, setShowBrowserScreenshotsState] =
    useState(true)
  const [blurScreenshotsUntilClick, setBlurScreenshotsUntilClickState] =
    useState(false)

  useEffect(() => {
    void showBrowserScreenshotsStorage
      .getValue()
      .then(setShowBrowserScreenshotsState)
    void blurScreenshotsUntilClickStorage
      .getValue()
      .then(setBlurScreenshotsUntilClickState)

    const unwatchShow = showBrowserScreenshotsStorage.watch((value) => {
      setShowBrowserScreenshotsState(value ?? true)
    })
    const unwatchBlur = blurScreenshotsUntilClickStorage.watch((value) => {
      setBlurScreenshotsUntilClickState(value ?? false)
    })

    return () => {
      unwatchShow()
      unwatchBlur()
    }
  }, [])

  return {
    showBrowserScreenshots,
    blurScreenshotsUntilClick,
    setShowBrowserScreenshots: (value: boolean) =>
      showBrowserScreenshotsStorage.setValue(value),
    setBlurScreenshotsUntilClick: (value: boolean) =>
      blurScreenshotsUntilClickStorage.setValue(value),
  }
}
