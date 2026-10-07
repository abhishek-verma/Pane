import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

const listeners = new Map<Element, (visible: boolean) => void>()
let observer: IntersectionObserver | undefined

function observe(element: Element, listener: (visible: boolean) => void) {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        listeners.get(entry.target)?.(entry.isIntersecting)
    },
    { rootMargin: '800px 0px' },
  )
  listeners.set(element, listener)
  observer.observe(element)
  return () => {
    observer?.unobserve(element)
    listeners.delete(element)
    if (!listeners.size) {
      observer?.disconnect()
      observer = undefined
    }
  }
}

/** Release expensive React/Markdown trees outside the viewport, retaining their
 * measured space so scrolling back remounts the same content without data loss.
 * One shared observer covers all rows and all blocks within a single turn.
 */
export function ViewportBlock({
  children,
  estimatedHeight = 80,
  pinned = false,
}: {
  children: ReactNode
  estimatedHeight?: number
  pinned?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const height = useRef(estimatedHeight)
  const [visible, setVisible] = useState(
    typeof IntersectionObserver === 'undefined',
  )
  const mounted = visible || pinned
  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    let near = false
    let interactionListener: (() => void) | undefined
    const clearInteractionListener = () => {
      if (!interactionListener) return
      element.removeEventListener('focusout', interactionListener)
      document.removeEventListener('selectionchange', interactionListener)
      interactionListener = undefined
    }
    const update = () => {
      // Keep focused controls and the whole selected range alive. Recheck when
      // the interaction ends, even if no new intersection event is delivered.
      const selection = window.getSelection()
      if (
        !near &&
        (element.contains(document.activeElement) ||
          (selection &&
            !selection.isCollapsed &&
            selection.containsNode(element, true)))
      ) {
        if (!interactionListener) {
          interactionListener = () => queueMicrotask(update)
          element.addEventListener('focusout', interactionListener)
          document.addEventListener('selectionchange', interactionListener)
        }
        return
      }
      clearInteractionListener()
      if (!near && element.childElementCount)
        height.current = element.getBoundingClientRect().height
      setVisible(near)
    }
    const stop = observe(element, (intersects) => {
      near = intersects
      update()
    })
    return () => {
      stop()
      clearInteractionListener()
    }
  }, [])
  useLayoutEffect(() => {
    const element = ref.current
    if (!mounted || !element) return
    const measure = () => {
      height.current = element.getBoundingClientRect().height
    }
    measure()
    const resize = new ResizeObserver(measure)
    resize.observe(element)
    return () => resize.disconnect()
  }, [mounted])
  return (
    <div
      ref={ref}
      data-viewport-block={mounted ? 'mounted' : 'offscreen'}
      style={
        mounted
          ? { display: 'flow-root', minWidth: 0 }
          : { height: height.current, minWidth: 0 }
      }
    >
      {mounted ? children : null}
    </div>
  )
}
