import { afterEach, describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import {
  importPhaseFor,
  OnboardingV2,
  openBrowserOsNewTab,
} from './OnboardingV2'

const originalWindow = globalThis.window

function renderApp(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <OnboardingV2 />
    </MemoryRouter>,
  )
}

function installAssignableWindow(search: string) {
  let assignedUrl: string | null = null
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        search,
        assign(url: string) {
          assignedUrl = url
        },
      },
      sessionStorage: {
        getItem(key: string) {
          return storage.get(key) ?? null
        },
        setItem(key: string, value: string) {
          storage.set(key, value)
        },
      },
    },
  })
  return () => assignedUrl
}

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  })
})

describe('OnboardingV2 shell', () => {
  it('lands on step 0 with the welcome heading and primary CTA', () => {
    const html = renderApp()
    expect(html).toContain('The browser your agents')
    expect(html).toContain('drive')
    expect(html).toContain('Set up')
  })

  it('renders the visual rail with the v2 quote and three feature blocks', () => {
    const html = renderApp()
    expect(html).toContain('Pane')
    expect(html).toContain('Let the agent you already run')
    expect(html).toContain('Fast &amp; token-cheap')
    expect(html).toContain('Logged in as you')
    expect(html).toContain('Under your control')
  })

  it('renders a full-page main landmark without the fake macOS window chrome', () => {
    const html = renderApp()
    expect(html).toContain('<main')
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('Welcome to BrowserOS')
    expect(html).not.toContain('#FF5F57')
  })

  it('renders four step dots', () => {
    const html = renderApp()
    const matches = html.match(/data-step-dot="true"/g) ?? []
    expect(html).toContain('aria-label="Onboarding progress"')
    expect(matches.length).toBe(4)
  })

  it('opens BrowserOS new tab when onboarding completes', () => {
    const getAssignedUrl = installAssignableWindow(
      '?apiUrl=http%3A%2F%2F127.0.0.1%3A9234',
    )

    openBrowserOsNewTab()

    expect(getAssignedUrl()).toBe('chrome://newtab')
  })

  it('does not treat failed or completed Chromium states as import success', () => {
    expect(importPhaseFor('failed', true)).toBe('failed')
    expect(importPhaseFor('completed', true)).toBe('picker')
    expect(importPhaseFor('completed', false)).toBe('pre-quit')
  })
})
