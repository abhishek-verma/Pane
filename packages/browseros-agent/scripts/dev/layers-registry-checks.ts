import type { Browser, WebWorker } from 'puppeteer-core'

/** Actual registry, bootstrap and SDK in Chromium. Only the declared action
 * provider is a deterministic fixture; it makes no network/model calls. */
export async function checkProductionScriptRegistry(
  browser: Browser,
  worker: WebWorker,
  url: string,
): Promise<string[]> {
  await worker.evaluate(async (url) => {
    const state = globalThis as any
    const definition = {
      protocol: 'pane.layers.v1',
      name: 'Registry test',
      intent: 'Exercise private script lifecycle',
      mode: 'javascript',
      scope: {
        origin: new URL(url).origin,
        paths: [new URL(url).pathname],
        excludePaths: [],
        query: {},
      },
      operations: [],
      actions: [
        {
          id: 'translate',
          kind: 'transform',
          trigger: 'click',
          instruction: 'Translate',
          targetLanguage: 'en',
          outputSchema: 'pane.translation.v1',
          providerId: 'fixture',
          limits: { maxSteps: 2, maxOutputTokens: 512, deadlineMs: 10000 },
        },
      ],
      source: `const root=document.createElement('div');root.id='registry-owned';
        const button=document.createElement('button');button.id='registry-action';button.textContent='Translate';root.append(button);
        document.body.append(paneLayer.own(root));document.body.dataset.untrackedRegistry='present';
        paneLayer.listen(button,'click',async()=>{
          button.dataset.status='running';
          try{const value=await paneLayer.request('translate',{});button.textContent=value.text;button.dataset.status='done'}
          catch{button.dataset.status='rejected'}
        });`,
    }
    state.registryLayer = {
      id: 'registry-test',
      version: await state.scriptDefinitionDigest(definition),
      definition,
    }
    state.registryActionCount = 0
    state.registryOptions = {
      profileId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      authorized: () => true,
      action: async () => {
        state.registryActionCount++
        if (state.registryDelay)
          return new Promise((resolve) => {
            state.registryRelease = resolve
          })
        return { text: 'Translated' }
      },
    }
    state.registry = state.createScriptRegistry(state.registryOptions)
    await state.registry.synchronize([state.registryLayer])
  }, url)
  const page = await browser.newPage()
  try {
    await page.goto(url)
    await page.bringToFront()
    await page.waitForSelector('#registry-action', { timeout: 10000 })
    const tabId = await worker.evaluate(
      async (url) =>
        (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id,
      url,
    )
    if (tabId === undefined)
      throw new Error('Production registry fixture tab missing.')
    await page.evaluate(() => {
      ;(document.querySelector('#registry-action') as HTMLButtonElement).click()
    })
    await page.waitForSelector('#registry-action[data-status="rejected"]')
    if (
      (await worker.evaluate(() => (globalThis as any).registryActionCount)) !==
      0
    )
      throw new Error('Synthetic click dispatched a model action.')
    await page.click('#registry-action')
    await page.waitForSelector('#registry-action[data-status="done"]')
    const first = await worker.evaluate(
      (tabId) => (globalThis as any).registry.status(tabId),
      tabId,
    )
    if (first[0]?.status !== 'executed')
      throw new Error(
        `Production registry execution failed: ${JSON.stringify(first)}`,
      )
    await worker.evaluate(async () => {
      const state = globalThis as any
      const key = 'pane.layers.scripts.cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      const record = (await chrome.storage.local.get(key))[key][0]
      await chrome.userScripts.update([
        {
          id: record.registrationId,
          js: [{ code: '/* previous bootstrap revision */' }],
        },
      ])
      await state.registry.synchronize([state.registryLayer])
      const saved = (await chrome.storage.local.get(key))[key][0]
      const registered = (
        await chrome.userScripts.getScripts({ ids: [record.registrationId] })
      )[0]
      if (
        saved.token !== record.token ||
        !registered.js?.[0].code?.includes('previousInstanceId')
      )
        throw new Error(
          'Native bootstrap refresh changed identity or retained old code.',
        )
    })
    if ((await page.$$eval('#registry-owned', (nodes) => nodes.length)) !== 1)
      throw new Error('Refreshing the bootstrap duplicated mounted source.')
    await worker.evaluate(async () => {
      const state = globalThis as any
      // Simulate abrupt loss of the worker's in-memory map, retaining the page.
      chrome.runtime.onUserScriptMessage.removeListener(state.registry.listener)
      state.registry = state.createScriptRegistry(state.registryOptions)
      await state.registry.synchronize([state.registryLayer])
    })
    await page.click('#registry-action')
    await page.waitForFunction(
      () =>
        document
          .querySelector('#registry-action')
          ?.getAttribute('data-status') === 'done',
    )
    const recovered = await worker.evaluate(
      (tabId) => ({
        count: (globalThis as any).registryActionCount,
        status: (globalThis as any).registry.status(tabId),
      }),
      tabId,
    )
    if (
      recovered.count !== 2 ||
      recovered.status[0]?.status !== 'executed' ||
      (await page.$$eval('#registry-owned', (nodes) => nodes.length)) !== 1
    )
      throw new Error(
        'Worker re-attestation reran source or lost the action binding.',
      )
    const evalBlocked = await worker.evaluate(async (tabId) => {
      const saved = (
        await chrome.storage.local.get(
          'pane.layers.scripts.cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        )
      )['pane.layers.scripts.cccccccc-cccc-4ccc-8ccc-cccccccccccc'][0]
      const result = await chrome.userScripts.execute({
        target: { tabId },
        world: 'USER_SCRIPT',
        worldId: saved.worldId,
        js: [
          { code: `(()=>{try{eval('1');return false}catch{return true}})()` },
        ],
      })
      return result[0]?.result
    }, tabId)
    if (!evalBlocked)
      throw new Error('Userscript world CSP allowed dynamic eval.')
    await page.evaluate(() => {
      const state = window as any
      state.registryOriginalNode = document.querySelector('#registry-owned')
      state.registryRestores = 0
      window.addEventListener('pageshow', (event) => {
        if (event.persisted) state.registryRestores++
      })
      ;(document.querySelector('#preserved-form') as HTMLInputElement).value =
        'Keep this draft'
    })
    await page.goto(new URL('/registry-away', url).href)
    // Production's loading listener drops per-tab state. Exercise recovery
    // with that state absent while the browser retains the old script world.
    await worker.evaluate(
      (tabId) => (globalThis as any).registry.forgetTab(tabId),
      tabId,
    )
    await page.goBack()
    await page.waitForFunction(() => (window as any).registryRestores === 1)
    await page.click('#registry-action')
    await page.waitForSelector('#registry-action[data-status="done"]')
    const restored = await worker.evaluate(
      (tabId) => (globalThis as any).registry.status(tabId),
      tabId,
    )
    if (
      restored[0]?.status !== 'executed' ||
      restored[0].instanceId === recovered.status[0].instanceId ||
      !(await page.evaluate(
        () =>
          (window as any).registryOriginalNode ===
            document.querySelector('#registry-owned') &&
          (document.querySelector('#preserved-form') as HTMLInputElement)
            .value === 'Keep this draft',
      )) ||
      (await page.$$eval('#registry-owned', (nodes) => nodes.length)) !== 1
    )
      throw new Error(
        'BFCache did not preserve the script/form or rotate its action instance.',
      )
    for (let cycle = 0; cycle < 4; cycle++) {
      await page.goto(new URL('/registry-away', url).href)
      await page.goBack()
      await page.waitForFunction(
        (expected) => (window as any).registryRestores === expected,
        {},
        cycle + 2,
      )
      await page.click('#registry-action')
      await page.waitForSelector('#registry-action[data-status="done"]')
      if (
        !(await page.evaluate(
          () =>
            (window as any).registryOriginalNode ===
              document.querySelector('#registry-owned') &&
            (document.querySelector('#preserved-form') as HTMLInputElement)
              .value === 'Keep this draft',
        ))
      )
        throw new Error(
          'Repeated BFCache transitions lost source identity or form state',
        )
    }
    await worker.evaluate(() => {
      ;(globalThis as any).registryDelay = true
    })
    await page.click('#registry-action')
    await worker.evaluate(async () => {
      const state = globalThis as any
      for (let n = 0; n < 100 && !state.registryRelease; n++)
        await new Promise((resolve) => setTimeout(resolve, 10))
      if (!state.registryRelease)
        throw new Error('Navigation action did not start.')
    })
    await page.goto(new URL('/registry-away', url).href)
    await worker.evaluate((tabId) => {
      const state = globalThis as any
      state.registry.forgetTab(tabId)
      state.registryRelease({ text: 'Late navigation result' })
      delete state.registryRelease
      state.registryDelay = false
    }, tabId)
    await page.goBack()
    await page.waitForSelector('#registry-action')
    await page.click('#registry-action')
    await page.waitForFunction(
      () =>
        document.querySelector('#registry-action')?.textContent ===
        'Translated',
    )
    if (
      await page.evaluate(() =>
        document.body.textContent?.includes('Late navigation result'),
      )
    )
      throw new Error('An old action result reached the restored page.')
    await worker.evaluate(() => {
      ;(globalThis as any).registryDelay = true
    })
    await page.click('#registry-action')
    await worker.evaluate(async () => {
      const state = globalThis as any
      for (let n = 0; n < 100 && !state.registryRelease; n++)
        await new Promise((resolve) => setTimeout(resolve, 10))
      if (!state.registryRelease)
        throw new Error('Delayed action did not start.')
      await state.registry.synchronize([])
      state.registryRelease({ text: 'Late result' })
    })
    await page.waitForFunction(() => !document.querySelector('#registry-owned'))
    if (
      (await page.evaluate(() => document.body.dataset.untrackedRegistry)) !==
      'present'
    )
      throw new Error('Probe lost its untracked-mutation recovery case.')
    await page.reload()
    if (await page.$('#registry-owned'))
      throw new Error('Disabled script reappeared after reload.')
    await worker.evaluate(async () => {
      const state = globalThis as any
      state.registryDelay = false
      await state.registry.synchronize([state.registryLayer])
    })
    await page.reload()
    await page.waitForSelector('#registry-owned')
    await page.evaluate(() => {
      ;(window as any).registryRestores = 0
      window.addEventListener('pageshow', (event) => {
        if (event.persisted) (window as any).registryRestores++
      })
    })
    await page.goto(new URL('/registry-away', url).href)
    await worker.evaluate(async () => {
      await (globalThis as any).registry.synchronize([])
    })
    await page.goBack()
    await page.waitForFunction(
      () =>
        (window as any).registryRestores === 1 &&
        !document.querySelector('#registry-owned'),
    )
    await worker.evaluate(async () => {
      const state = globalThis as any
      await state.registry.synchronize([state.registryLayer])
    })
    await page.reload()
    await page.waitForSelector('#registry-owned')
    await page.evaluate(() =>
      history.pushState({}, '', '/outside-registry-scope'),
    )
    await page.waitForFunction(() => !document.querySelector('#registry-owned'))
    return [
      'production registry dispatches source only in its authenticated document',
      'older registered bootstraps refresh for future visits without replaying mounted source',
      'production SDK rejects synthetic clicks and accepts trusted declared actions',
      'production registry re-attests after simulated worker loss without duplicate source',
      'userscript world CSP blocks dynamic eval',
      'disable rejects late action results and removes tracked UI',
      'untracked effects survive disable and are cleared by reload',
      'disabled registrations stay absent on reload and re-enable restores future visits',
      'SDK stops tracked work after SPA route changes',
      'real BFCache restoration preserves script DOM and form state without replaying source',
      'four repeated BFCache transitions preserve source identity, forms and working actions',
      'BFCache re-attests a fresh action instance after per-tab state loss',
      'navigation cancels delayed script actions without applying their late results after Back',
      'disabling a cached script removes it when the browser restores the page',
    ]
  } finally {
    await worker.evaluate(async () => {
      const state = globalThis as any
      await state.registry?.synchronize([])
      state.registry?.dispose()
    })
    await page.close()
  }
}
