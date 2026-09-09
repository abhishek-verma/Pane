import type { Page } from 'puppeteer-core'

/** Real React controls, browser zoom, keyboard input and Chromium AX tree.
 * This is a focused check, not a substitute for manual screen-reader QA. */
export async function checkLayersAccessibility(ui: Page, name: string) {
  const viewport = ui.viewport()
  const tabId = await ui.evaluate(
    async () => (await chrome.tabs.getCurrent())?.id,
  )
  if (tabId === undefined) throw new Error('Accessibility fixture tab missing')
  const zoom = await ui.evaluate((id) => chrome.tabs.getZoom(id), tabId)
  const session = await ui.createCDPSession()
  const layouts: Array<{
    width: number
    zoom: number
    direction: string
    theme: string
  }> = []
  try {
    await ui.bringToFront()
    await ui.focus('[aria-label="Refresh Layers"]')
    let reachedSearch = false
    for (let i = 0; i < 12; i++) {
      await ui.keyboard.press('Tab')
      if (
        await ui.evaluate(
          () =>
            document.activeElement?.getAttribute('aria-label') ===
            'Search Layers',
        )
      ) {
        reachedSearch = true
        break
      }
    }
    if (!reachedSearch)
      throw new Error('Layers search is not reachable by keyboard')
    await ui.keyboard.type(name)
    await ui.waitForFunction(
      (name) =>
        document.querySelectorAll('article').length === 1 &&
        document.querySelector('article h2')?.textContent === name,
      {},
      name,
    )
    await ui.keyboard.press('Tab')
    if (
      !(await ui.evaluate(() => document.activeElement?.tagName === 'SUMMARY'))
    )
      throw new Error('Draft disclosure is not next in the keyboard order')
    await ui.keyboard.press('Enter')
    if (
      !(await ui.evaluate(() =>
        document.querySelector('article details')?.hasAttribute('open'),
      ))
    )
      throw new Error('Scope disclosure did not open from the keyboard')
    for (const layout of [
      { width: 360, zoom: 1, direction: 'ltr', theme: 'light' },
      { width: 720, zoom: 2, direction: 'rtl', theme: 'light' },
      { width: 720, zoom: 2, direction: 'rtl', theme: 'dark' },
    ]) {
      await ui.setViewport({ width: layout.width, height: 1000 })
      await ui.evaluate(({ id, zoom }) => chrome.tabs.setZoom(id, zoom), {
        id: tabId,
        zoom: layout.zoom,
      })
      await ui.evaluate(({ direction, theme }) => {
        document.documentElement.dir = direction
        document.documentElement.classList.toggle('dark', theme === 'dark')
      }, layout)
      await ui.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      )
      await ui.evaluate(async () => {
        const finite = document
          .getAnimations()
          .filter((animation) =>
            Number.isFinite(animation.effect?.getComputedTiming().endTime),
          )
        await Promise.allSettled(finite.map((animation) => animation.finished))
      })
      const size = await ui.evaluate(
        async (id) => ({
          viewport: innerWidth,
          content: document.documentElement.scrollWidth,
          zoom: await chrome.tabs.getZoom(id),
        }),
        tabId,
      )
      if (
        Math.abs(size.zoom - layout.zoom) > 0.01 ||
        size.content > size.viewport + 1
      )
        throw new Error(
          `Layers layout failed zoom/reflow: ${JSON.stringify({ layout, size })}`,
        )
      const overflow = await ui.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            'button,h1,h2,p,summary,input',
          ),
        ]
          .filter(
            (element) => element.checkVisibility() && !element.closest('pre'),
          )
          .flatMap((element) => {
            const bounds = element.getBoundingClientRect()
            return bounds.left < -1 || bounds.right > innerWidth + 1
              ? [
                  element.getAttribute('aria-label') ||
                    element.textContent?.slice(0, 40),
                ]
              : []
          }),
      )
      if (overflow.length)
        throw new Error(
          `Layers controls overflow the RTL/LTR viewport: ${JSON.stringify(overflow)}`,
        )
      const contrastFailures = await ui.evaluate(() => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const context = canvas.getContext('2d', { willReadFrequently: true })!
        const color = (value: string) => {
          context.clearRect(0, 0, 1, 1)
          context.fillStyle = value
          context.fillRect(0, 0, 1, 1)
          return [...context.getImageData(0, 0, 1, 1).data].map(
            (value) => value / 255,
          )
        }
        const blend = (front: number[], back: number[]) =>
          [0, 1, 2]
            .map((i) => front[i] * front[3] + back[i] * (1 - front[3]))
            .concat(1)
        const luminance = (rgba: number[]) =>
          rgba
            .slice(0, 3)
            .map((value) =>
              value <= 0.04045
                ? value / 12.92
                : ((value + 0.055) / 1.055) ** 2.4,
            )
            .reduce(
              (sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i],
              0,
            )
        return [
          ...document.querySelectorAll<HTMLElement>('button,h1,h2,summary'),
        ]
          .filter(
            (element) =>
              element.checkVisibility() &&
              !(element as HTMLButtonElement).disabled,
          )
          .flatMap((element) => {
            const chain: HTMLElement[] = []
            for (
              let node: HTMLElement | null = element;
              node;
              node = node.parentElement
            )
              chain.unshift(node)
            let background = [1, 1, 1, 1]
            for (const node of chain)
              background = blend(
                color(getComputedStyle(node).backgroundColor),
                background,
              )
            const style = getComputedStyle(element),
              foreground = blend(color(style.color), background)
            const values = [luminance(foreground), luminance(background)].sort(
              (a, b) => b - a,
            )
            const ratio = (values[0] + 0.05) / (values[1] + 0.05)
            const large =
              parseFloat(style.fontSize) >= 24 ||
              (parseFloat(style.fontSize) >= 18.66 &&
                Number(style.fontWeight) >= 700)
            const threshold = !element.textContent?.trim() || large ? 3 : 4.5
            return ratio + 0.05 < threshold
              ? [
                  {
                    name:
                      element.getAttribute('aria-label') ||
                      element.textContent?.slice(0, 40),
                    ratio,
                    threshold,
                  },
                ]
              : []
          })
      })
      if (contrastFailures.length)
        throw new Error(
          `Layers control contrast failed: ${JSON.stringify({ layout, contrastFailures })}`,
        )
      layouts.push(layout)
    }
    const tree = await session.send('Accessibility.getFullAXTree')
    const nodes = tree.nodes.filter((node) => !node.ignored)
    const controls = nodes.filter((node) =>
      ['button', 'searchbox', 'DisclosureTriangle'].includes(
        String(node.role?.value),
      ),
    )
    if (
      !controls.length ||
      controls.some((node) => !String(node.name?.value ?? '').trim())
    )
      throw new Error('A visible Layers control has no accessible name')
    if (
      !nodes.some(
        (node) => node.role?.value === 'article' && node.name?.value === name,
      )
    )
      throw new Error(
        'The Layer card does not expose its heading as an accessible name',
      )
    await ui.evaluate(() => window.scrollTo(0, 0))
    await ui.screenshot({
      path: '/tmp/pane-layers-accessibility.png',
      fullPage: false,
    })
    return {
      passed: [
        'library search and scope disclosure work from the keyboard',
        'long Layer names and scopes reflow at narrow width and actual 200% browser zoom',
        'library RTL layout and light/dark themes avoid horizontal overflow',
        'Chromium accessibility tree exposes named controls and Layer cards',
        'visible library headings and controls meet measured contrast thresholds',
      ],
      layouts,
      namedControls: controls.length,
    }
  } finally {
    await session.detach()
    await ui.evaluate(
      async ({ id, zoom }) => {
        await chrome.tabs.setZoom(id, zoom)
        document.documentElement.dir = 'ltr'
        document.documentElement.classList.remove('dark')
      },
      { id: tabId, zoom },
    )
    if (viewport) await ui.setViewport(viewport)
    await ui.focus('[aria-label="Search Layers"]')
    await ui.keyboard.down('Meta')
    await ui.keyboard.press('A')
    await ui.keyboard.up('Meta')
    await ui.keyboard.press('Backspace')
  }
}
