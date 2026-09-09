/** This function is serialized into a USER_SCRIPT world. Keep it self-contained.
 * User source is injected in a separate compilation, never in this closure.
 * The browser's MessageSender has no worldId, so the closure's private token
 * attests the registration while native sender metadata binds the document.
 */
function bootstrap(options: { token: string; instanceKey: string }) {
  if (Object.hasOwn(globalThis, options.instanceKey)) {
    void (
      globalThis as unknown as Record<string, { ping: () => Promise<void> }>
    )[options.instanceKey].ping()
    return
  }
  const send = chrome.runtime.sendMessage.bind(chrome.runtime)
  const freeze = Object.freeze.bind(Object)
  const define = Object.defineProperty.bind(Object)
  const create = Object.create.bind(Object)
  const interval = globalThis.setInterval.bind(globalThis)
  const clear = globalThis.clearInterval.bind(globalThis)
  const addEvent = EventTarget.prototype.addEventListener
  const removeEvent = EventTarget.prototype.removeEventListener
  const uuid = crypto.randomUUID.bind(crypto)
  let instanceId = uuid()
  const initialUrl = location.href
  const activation = navigator.userActivation
  const activationGetter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(activation),
    'isActive',
  )?.get?.bind(activation)
  const disposers: Array<() => void> = []
  let stopped = false
  let suspended = false
  let started = false
  let completed = false
  let trustedClick = false
  let generation = 0
  const request = async (
    kind: string,
    payload?: unknown,
    userGesture = false,
  ) => {
    if (stopped || (suspended && kind !== 'resume'))
      throw new Error('This Layer has stopped. Reload to restart it.')
    const requestGeneration = generation
    // Native messaging JSON-serializes its input. A normal object would let
    // user code install Object.prototype.toJSON and steal the private token.
    const envelope = create(null)
    envelope.channel = 'pane.layers.script.v1'
    envelope.token = options.token
    envelope.instanceId = instanceId
    envelope.kind = kind
    envelope.payload = payload
    envelope.userGesture = userGesture
    const response = await send(envelope)
    if (stopped || generation !== requestGeneration)
      throw new Error('Layer stopped.')
    if (!response?.ok) throw new Error(response?.error ?? 'Layer unavailable.')
    return response.value
  }
  const cleanup = () => {
    if (stopped) return
    stopped = true
    generation++
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose()
      } catch {
        // Arbitrary user cleanup cannot prevent the other tracked disposers.
      }
    }
  }
  const track = (dispose: () => void) => {
    if (stopped) throw new Error('Layer stopped.')
    if (typeof dispose !== 'function')
      throw new Error('Expected cleanup function.')
    if (disposers.length >= 256)
      throw new Error('Layer resource limit reached.')
    disposers.push(dispose)
    return dispose
  }
  const sdk = freeze({
    version: 1,
    get stopped() {
      return stopped
    },
    /** Only declared, server-validated operations may be dispatched by the host. */
    request: async (actionId: string, input: unknown) => {
      const userGesture = trustedClick && Boolean(activationGetter?.())
      // A restarted extension worker may have lost its live instance map.
      // Re-attest before dispatch; the host's begin guard prevents re-running
      // source that already started in this document.
      await request('hello')
      return request('action', { actionId, input }, userGesture)
    },
    onCleanup: track,
    own: (node: Node) => {
      if (!(node instanceof Node)) throw new Error('Expected DOM node.')
      track(() => node.parentNode?.removeChild(node))
      return node
    },
    interval: (callback: () => void, milliseconds: number) => {
      if (
        typeof callback !== 'function' ||
        !Number.isFinite(milliseconds) ||
        milliseconds < 100
      )
        throw new Error('Intervals require a callback and at least 100 ms.')
      // Reserve a disposer before allocating a resource.
      let timer: ReturnType<typeof setInterval> | undefined
      const dispose = track(() => {
        if (timer !== undefined) clear(timer)
      })
      timer = interval(() => {
        if (!stopped && !suspended) callback()
      }, milliseconds)
      return dispose
    },
    listen: (target: EventTarget, event: string, callback: EventListener) => {
      if (
        !(target instanceof EventTarget) ||
        typeof callback !== 'function' ||
        typeof event !== 'string'
      )
        throw new Error('Expected event target, name and listener.')
      const listener: EventListener = (value) => {
        if (stopped || suspended) return
        const previous = trustedClick
        trustedClick =
          value.isTrusted &&
          (value.type === 'click' ||
            (value instanceof KeyboardEvent &&
              value.type === 'keydown' &&
              ['Enter', ' '].includes(value.key)))
        try {
          callback.call(target, value)
        } finally {
          trustedClick = previous
        }
      }
      const dispose = track(() => removeEvent.call(target, event, listener))
      addEvent.call(target, event, listener)
      return dispose
    },
    observe: (
      target: Node,
      callback: MutationCallback,
      settings: MutationObserverInit,
    ) => {
      const observer = new MutationObserver((records, observer) => {
        if (!stopped && !suspended) callback(records, observer)
      })
      track(() => observer.disconnect())
      observer.observe(target, settings)
      return observer
    },
  })
  // These functions expose their names, but neither exposes its enclosing
  // source/token through Function#toString. No token is written into the DOM.
  define(globalThis, 'paneLayer', {
    value: sdk,
    configurable: false,
    writable: false,
  })
  define(globalThis, options.instanceKey, {
    value: freeze({
      cleanup,
      get instanceId() {
        return instanceId
      },
      begin: () => {
        if (stopped || started) return false
        started = true
        return true
      },
      finish: () => {
        completed = true
      },
      state: () => ({ instanceId, stopped, completed }),
      ping: async () => {
        const pingGeneration = generation
        try {
          await request('hello')
        } catch {
          if (started && !suspended && generation === pingGeneration) cleanup()
        }
      },
    }),
    configurable: false,
    writable: false,
  })
  const helloGeneration = generation
  void request('hello').catch(() => {
    if (generation === helloGeneration && started) cleanup()
  })
  // Route changes cannot leave tracked work running outside the saved scope.
  // Arbitrary untracked effects still require a reload to remove completely.
  const routeTimer = interval(() => {
    if (location.href !== initialUrl) cleanup()
  }, 250)
  disposers.push(() => clear(routeTimer))
  addEvent.call(globalThis, 'pagehide', (value: Event) => {
    const event = value as PageTransitionEvent
    if (!event.isTrusted) return
    if (!event.persisted || !completed) {
      cleanup()
      return
    }
    // BFCache retains this exact JS world and DOM. Keep tracked resources but
    // make callbacks and old async replies inert until native re-attestation.
    suspended = true
    trustedClick = false
    generation++
  })
  addEvent.call(globalThis, 'pageshow', (value: Event) => {
    const event = value as PageTransitionEvent
    if (!event.isTrusted || !event.persisted || !suspended || stopped) return
    const previousInstanceId = instanceId
    instanceId = uuid()
    const resumeGeneration = ++generation
    void request('resume', { previousInstanceId }).then(
      () => {
        if (!stopped && generation === resumeGeneration) suspended = false
      },
      () => {
        if (generation === resumeGeneration) cleanup()
      },
    )
  })
}

export function userScriptBootstrap(
  token: string,
  instanceKey: string,
): string {
  if (
    !/^[a-f0-9]{64}$/.test(token) ||
    !/^pane_layer_[a-f0-9]{32}$/.test(instanceKey)
  )
    throw new Error('Invalid private Layer registration identity.')
  return `(${bootstrap.toString()})(${JSON.stringify({ token, instanceKey })});`
}
