import { randomBytes } from 'node:crypto'
import type { Browser, WebWorker } from 'puppeteer-core'
import { userScriptBootstrap } from '../../apps/app/entrypoints/background/layers/user-script-bootstrap'

const registrations = ['a', 'b'].map((name) => ({
  name,
  token: randomBytes(32).toString('hex'),
  key: `pane_layer_${randomBytes(16).toString('hex')}`,
  worldId: `pane-layer-probe-${name}`,
  id: `pane-layer-probe-${name}`,
}))

/** Real Chromium boundary probe. No installed profile or real provider is used. */
export async function checkUserScriptWorlds(
  browser: Browser,
  worker: WebWorker,
  url: string,
  visit: number,
): Promise<string[]> {
  const passed: string[] = []
  const setup = await worker.evaluate(
    async ({ registrations, visit }) => {
      const api = chrome.userScripts
      if (!api) throw new Error('Native enablement did not expose userScripts.')
      const restored = await api.getScripts()
      const saved = (await chrome.storage.local.get('scriptProbeRegistrations'))
        .scriptProbeRegistrations
      if (
        visit > 0 &&
        (!Array.isArray(saved) ||
          saved.length !== registrations.length ||
          registrations.some((item, index) =>
            Object.entries(item).some(
              ([key, value]) => saved[index]?.[key] !== value,
            ),
          ))
      )
        throw new Error(
          'Saved script registration identity did not survive browser restart.',
        )
      const events: Array<Record<string, unknown>> = []
      const state = { events, injected: new Set<string>() }
      ;(globalThis as any).scriptProbe = state
      const handler: Parameters<
        typeof chrome.runtime.onUserScriptMessage.addListener
      >[0] = (message, sender, respond) => {
        const registration = registrations.find(
          (item) => item.token === message?.token,
        )
        if (
          !registration ||
          message.channel !== 'pane.layers.script.v1' ||
          sender.id !== chrome.runtime.id ||
          sender.frameId !== 0 ||
          !sender.documentId ||
          sender.tab?.id === undefined
        ) {
          respond({ ok: false, error: 'Unauthenticated script.' })
          return false
        }
        // No caller-supplied Layer ID participates in identity selection.
        events.push({
          name: registration.name,
          kind: message.kind,
          documentId: sender.documentId,
          frameId: sender.frameId,
          worldId: (sender as any).worldId ?? null,
        })
        if (message.kind === 'hello') {
          const identity = `${sender.documentId}:${registration.name}`
          respond({ ok: true })
          if (state.injected.has(identity)) return false
          state.injected.add(identity)
          // Deliberately separate from the bootstrap's compilation/closure.
          void api
            .execute({
              target: {
                tabId: sender.tab.id,
                documentIds: [sender.documentId],
              },
              world: 'USER_SCRIPT',
              worldId: registration.worldId,
              js: [
                {
                  code: `globalThis.privateLayerValue=${JSON.stringify(registration.name)};
            document.body.setAttribute('data-layer-${registration.name}', 'mounted');`,
                },
              ],
            })
            .catch((error) => events.push({ error: String(error) }))
        } else if (
          message.kind === 'action' &&
          message.payload?.actionId === 'ping'
        ) {
          respond({
            ok: true,
            value: {
              layer: registration.name,
              documentId: sender.documentId,
            },
          })
        } else respond({ ok: false, error: 'Undeclared operation.' })
        return false
      }
      ;(state as any).handler = handler
      chrome.runtime.onUserScriptMessage.addListener(handler)
      // An unpacked-extension reload clears registrations. Rebuild from the
      // extension-owned durable state, as production must also do on updates.
      await chrome.storage.local.set({
        scriptProbeRegistrations: registrations,
      })
      await api.unregister()
      for (const registration of visit > 0 ? saved : registrations) {
        // Re-apply world settings as well as registrations. Chromium's
        // unchanged configureWorld path does not notify existing renderers
        // after an unpacked extension reload.
        await api.resetWorldConfiguration(registration.worldId)
        await api.configureWorld({
          worldId: registration.worldId,
          messaging: true,
        })
        await api.register([
          {
            id: registration.id,
            world: 'USER_SCRIPT',
            worldId: registration.worldId,
            matches: ['http://127.0.0.1/*'],
            runAt: 'document_idle',
            js: [{ code: registration.bootstrap }],
          },
        ])
      }
      return { restored: restored.length }
    },
    {
      registrations: registrations.map((item) => ({
        ...item,
        bootstrap: userScriptBootstrap(item.token, item.key),
      })),
      visit,
    },
  )
  passed.push('native engine available without a developer-mode switch')
  if (visit > 0)
    passed.push(
      setup.restored === 2
        ? 'registrations persist across browser restart'
        : 'fixture restores cleared registrations from extension-owned storage after restart',
    )
  const page = await browser.newPage()
  const waitForMount = async (stage: string) => {
    try {
      await page.waitForSelector(
        'body[data-layer-a="mounted"][data-layer-b="mounted"]',
        { timeout: 10000 },
      )
    } catch {
      const events = await worker.evaluate(
        async ({ url, worldId }) => {
          const tab = (await chrome.tabs.query({})).find(
            (tab) => tab.url === url,
          )
          const probe =
            tab?.id === undefined
              ? []
              : await chrome.userScripts.execute({
                  target: { tabId: tab.id },
                  world: 'USER_SCRIPT',
                  worldId,
                  js: [
                    {
                      code: `({sdk:typeof globalThis.paneLayer,stopped:globalThis.paneLayer?.stopped,messaging:typeof globalThis.chrome?.runtime?.sendMessage})`,
                    },
                  ],
                })
          return {
            messages: (globalThis as any).scriptProbe?.events,
            probe,
            scripts: (await chrome.userScripts.getScripts()).map(
              ({ id }) => id,
            ),
            worlds: await chrome.userScripts.getWorldConfigurations(),
          }
        },
        { url, worldId: registrations[0].worldId },
      )
      throw new Error(
        `Userscript mount failed (${stage}, visit ${visit}): ${JSON.stringify(events)}`,
      )
    }
  }
  try {
    await page.goto(url)
    await waitForMount('initial')
    const tabId = await worker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({})
      return tabs.find((tab) => tab.url === url)?.id
    }, url)
    if (tabId === undefined) throw new Error('Probe tab missing.')
    const checks = await worker.evaluate(
      async ({ tabId, registrations }) => {
        const execute = async (worldId: string, code: string) => {
          const result = await chrome.userScripts.execute({
            target: { tabId, frameIds: [0] },
            world: 'USER_SCRIPT',
            worldId,
            js: [{ code }],
          })
          if (result[0]?.error) throw new Error(result[0].error)
          return result[0]?.result
        }
        const a = registrations[0],
          b = registrations[1]
        const own = await execute(
          a.worldId,
          `paneLayer.request('ping', { layerId: 'b' })`,
        )
        const distinct = await execute(
          b.worldId,
          `({ value: globalThis.privateLayerValue,
        siblingBootstrap: typeof globalThis[${JSON.stringify(a.key)}],
        frozen: Object.isFrozen(paneLayer),
        exposed: paneLayer.request.toString() })`,
        )
        const forged = await execute(
          b.worldId,
          `chrome.runtime.sendMessage({channel:'pane.layers.script.v1',
        kind:'action', token:'${'0'.repeat(64)}', layerId:'a', payload:{ actionId:'ping' }})`,
        )
        const undeclared = await execute(
          a.worldId,
          `paneLayer.request('not-declared', {}).then(()=>false,()=>true)`,
        )
        const prototypeAttack = await execute(
          b.worldId,
          `(async()=>{
        let tokenSeen=false;
        Object.prototype.toJSON=function(){if(this.token) tokenSeen=true; return this};
        try { await paneLayer.request('ping', {}); return tokenSeen; }
        finally { delete Object.prototype.toJSON; }
      })()`,
        )
        const tracked = await execute(
          a.worldId,
          `(()=>{
        const node = document.createElement('span'); node.id='tracked-script-node';
        document.body.append(paneLayer.own(node));
        document.body.dataset.untrackedMutation='present';
        globalThis[${JSON.stringify(a.key)}].cleanup();
        return { removed: !document.getElementById('tracked-script-node'),
          untracked: document.body.dataset.untrackedMutation, stopped: paneLayer.stopped };
      })()`,
        )
        const stopped = await execute(
          a.worldId,
          `paneLayer.request('ping', {}).then(()=>false,()=>true)`,
        )
        const contentForge = await chrome.scripting.executeScript({
          target: { tabId },
          func: async () => {
            try {
              return await chrome.runtime.sendMessage({
                channel: 'pane.layers.script.v1',
                kind: 'hello',
              })
            } catch {
              return null
            }
          },
        })
        const events = (globalThis as any).scriptProbe.events
        return {
          own,
          distinct,
          forged,
          undeclared,
          prototypeAttack,
          tracked,
          stopped,
          events,
          contentAuthorized: Boolean(contentForge[0]?.result?.value?.layer),
        }
      },
      {
        tabId,
        registrations: registrations.map(({ name, key, worldId }) => ({
          name,
          key,
          worldId,
        })),
      },
    )
    if (
      checks.own?.layer !== 'a' ||
      checks.distinct.value !== 'b' ||
      checks.distinct.siblingBootstrap !== 'undefined'
    )
      throw new Error('Per-world identity isolation failed.')
    if (
      !checks.distinct.frozen ||
      registrations.some(({ token }) => checks.distinct.exposed.includes(token))
    )
      throw new Error('Bootstrap token or SDK mutable.')
    if (
      checks.forged?.ok !== false ||
      !checks.undeclared ||
      checks.contentAuthorized ||
      checks.prototypeAttack
    )
      throw new Error('Forged/undeclared messages accepted.')
    if (
      !checks.tracked.removed ||
      checks.tracked.untracked !== 'present' ||
      !checks.stopped
    )
      throw new Error('Cleanup/revocation contract failed.')
    if (
      !checks.events.length ||
      checks.events.some(
        (event: any) => event.error || !event.documentId || event.frameId !== 0,
      )
    )
      throw new Error('Native sender metadata missing.')
    passed.push(
      'separate USER_SCRIPT globals with shared DOM',
      'private bootstrap binds actual sender document',
      'caller Layer ID cannot impersonate sibling',
      'forged tokens and undeclared actions rejected',
      'prototype serialization attack cannot read the private token',
      'ordinary content-script messaging cannot call userscript handler',
      'tracked cleanup stops requests; untracked mutations honestly require reload',
    )
    await page.reload()
    await waitForMount('reload')
    passed.push('registered bootstraps reapply after reload')
    await worker.evaluate(async () => chrome.userScripts.unregister())
    if (!(await page.$('body[data-layer-a="mounted"]')))
      throw new Error('Unregister unexpectedly claimed to undo live effects.')
    await page.reload()
    await new Promise((resolve) => setTimeout(resolve, 250))
    if (await page.$('body[data-layer-a]'))
      throw new Error('Unregister did not stop future injections.')
    passed.push(
      'unregister stops future injection but leaves current DOM unchanged',
    )
    // Leave registrations installed for the next disposable-browser launch.
    await worker.evaluate(
      async (registrations) => {
        for (const item of registrations)
          await chrome.userScripts.register([
            {
              id: item.id,
              world: 'USER_SCRIPT',
              worldId: item.worldId,
              matches: ['http://127.0.0.1/*'],
              runAt: 'document_idle',
              js: [{ code: item.bootstrap }],
            },
          ])
      },
      registrations.map((item) => ({
        ...item,
        bootstrap: userScriptBootstrap(item.token, item.key),
      })),
    )
    return passed
  } finally {
    await worker.evaluate(() => {
      const handler = (globalThis as any).scriptProbe?.handler
      if (handler) chrome.runtime.onUserScriptMessage.removeListener(handler)
    })
    await page.close()
  }
}
