// biome-ignore-all lint/suspicious/noExplicitAny: Low-level browser API adapter requires flexible types
/// <reference path="./chrome-browser-os.d.ts" />

export type PrefObject = chrome.browserOS.PrefObject
export type ChoosePathOptions = chrome.browserOS.ChoosePathOptions
export type SelectedPath = chrome.browserOS.SelectedPath

/**
 * Thrown by `getPref` specifically when `chrome.browserOS.getPref` doesn't
 * exist at all (dev / non-BrowserOS Chromium) — a permanent, structural
 * condition for the lifetime of the page, distinct from a native call that
 * exists but fails or returns an unset value (which can resolve later).
 * Callers that want to cache a "this will never be available" result
 * (e.g. profile-key.ts) check for this type specifically.
 */
export class PrefApiUnavailableError extends Error {
  constructor() {
    super('getPref API not available')
    this.name = 'PrefApiUnavailableError'
  }
}

export class BrowserOSAdapter {
  private static instance: BrowserOSAdapter | null = null

  private constructor() {}

  static getInstance(): BrowserOSAdapter {
    if (!BrowserOSAdapter.instance) {
      BrowserOSAdapter.instance = new BrowserOSAdapter()
    }
    return BrowserOSAdapter.instance
  }

  async getVersion(): Promise<string | null> {
    return new Promise<string | null>((resolve, reject) => {
      if (typeof chrome.browserOS.getVersionNumber !== 'function') {
        resolve(null)
        return
      }

      chrome.browserOS.getVersionNumber((version: string) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Unknown error'))
        } else {
          resolve(version)
        }
      })
    })
  }

  async getBrowserosVersion(): Promise<string | null> {
    return new Promise<string | null>((resolve, reject) => {
      if (typeof chrome.browserOS.getBrowserosVersionNumber !== 'function') {
        resolve(null)
        return
      }

      chrome.browserOS.getBrowserosVersionNumber((version: string) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Unknown error'))
        } else {
          resolve(version)
        }
      })
    })
  }

  async logMetric(
    eventName: string,
    properties?: Record<string, any>,
  ): Promise<void> {
    if (typeof chrome.browserOS.logMetric !== 'function') {
      return
    }

    return new Promise<void>((resolve, reject) => {
      const callback = () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Unknown error'))
        } else {
          resolve()
        }
      }

      if (properties) {
        chrome.browserOS.logMetric(eventName, properties, callback)
      } else {
        chrome.browserOS.logMetric(eventName, callback)
      }
    })
  }

  async getPref(name: string): Promise<PrefObject> {
    if (typeof chrome.browserOS?.getPref !== 'function') {
      throw new PrefApiUnavailableError()
    }

    return new Promise<PrefObject>((resolve, reject) => {
      chrome.browserOS.getPref(name, (pref: PrefObject) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Unknown error'))
        } else {
          resolve(pref)
        }
      })
    })
  }

  async setPref(name: string, value: any, pageId?: string): Promise<boolean> {
    if (typeof chrome.browserOS?.setPref !== 'function') {
      throw new Error('setPref API not available')
    }

    return new Promise<boolean>((resolve, reject) => {
      const callback = (success: boolean) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Unknown error'))
        } else {
          resolve(success)
        }
      }

      if (pageId !== undefined) {
        chrome.browserOS.setPref(name, value, pageId, callback)
      } else {
        chrome.browserOS.setPref(name, value, callback)
      }
    })
  }

  async choosePath(options?: ChoosePathOptions): Promise<SelectedPath | null> {
    if (typeof chrome.browserOS?.choosePath !== 'function') {
      throw new Error('choosePath API not available')
    }

    return new Promise<SelectedPath | null>((resolve, reject) => {
      const callback = (result: SelectedPath | null) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Unknown error'))
        } else {
          resolve(result)
        }
      }

      if (options) {
        chrome.browserOS.choosePath(options, callback)
      } else {
        chrome.browserOS.choosePath(callback)
      }
    })
  }

  isAPIAvailable(method: string): boolean {
    return method in chrome.browserOS
  }

  getAvailableAPIs(): string[] {
    return Object.keys(chrome.browserOS).filter(
      (key) => typeof (chrome.browserOS as any)[key] === 'function',
    )
  }
}

/** @public */
export const getBrowserOSAdapter = () => BrowserOSAdapter.getInstance()
