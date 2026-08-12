'use client'

import { CheckIcon, CopyIcon } from 'lucide-react'
import {
  type ComponentProps,
  createContext,
  type HTMLAttributes,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { BundledLanguage } from 'shiki'
import { Button } from '@/components/ui/button'
import { highlightHtmlInSandbox } from '@/lib/code-highlight/shiki-sandbox-broker'
import { sentry } from '@/lib/sentry/sentry'
import { cn } from '@/lib/utils'

type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string
  language: BundledLanguage
  showLineNumbers?: boolean
}

type CodeBlockContextType = {
  code: string
}

const CodeBlockContext = createContext<CodeBlockContextType>({
  code: '',
})

export type HighlightedHtml = { light: string; dark: string; failed: boolean }

/**
 * @public
 * Runs in the Shiki sandbox (shiki-sandbox-broker.ts), not inline — tool
 * call input/output can be arbitrarily large, and this used to call Shiki's
 * codeToHtml() directly on the main thread for every render. See the
 * renderer OOM/hang investigation this was moved for.
 */
export async function highlightCode(
  code: string,
  language: BundledLanguage,
  showLineNumbers = false,
): Promise<HighlightedHtml> {
  // Promise.all here means both requests are enqueued together up front,
  // not that they run concurrently — the sandbox broker's queue processes
  // one request at a time (its own highlighting work is single-threaded
  // JS regardless), so this is back-to-back, not overlapped. Enqueuing
  // both immediately is still the right call: it keeps them adjacent in
  // the shared queue instead of interleaved with another CodeBlock's
  // requests.
  const [light, dark] = await Promise.all([
    highlightHtmlInSandbox(code, language, 'one-light', showLineNumbers),
    highlightHtmlInSandbox(code, language, 'one-dark-pro', showLineNumbers),
  ])
  if (!light.ok || !dark.ok) {
    sentry.captureException(
      new Error(!light.ok ? light.error : !dark.ok ? dark.error : 'unknown'),
      { extra: { message: 'Failed to highlight code block', language } },
    )
  }
  return {
    light: light.ok ? light.value : '',
    dark: dark.ok ? dark.value : '',
    failed: !light.ok || !dark.ok,
  }
}

/** @public */
export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const [result, setResult] = useState<HighlightedHtml | null>(null)
  // Guards against out-of-order resolution now that highlighting is a
  // queued sandbox round trip (possibly retried) rather than an inline
  // call — a later request can start and finish before an earlier one's
  // (e.g. streaming tool-call JSON re-triggering this effect faster than
  // the sandbox can keep up). Only the response matching the MOST
  // RECENTLY started request is ever applied, regardless of arrival order.
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    highlightCode(code, language, showLineNumbers).then((next) => {
      if (requestIdRef.current === requestId) setResult(next)
    })
  }, [code, language, showLineNumbers])

  if (result?.failed) {
    return (
      <CodeBlockContext.Provider value={{ code }}>
        <div
          className={cn(
            'group relative w-full overflow-hidden rounded-md border bg-background text-foreground',
            className,
          )}
          {...props}
        >
          <div className="relative">
            <pre className="m-0 overflow-auto whitespace-pre-wrap p-4 font-mono text-sm">
              {code}
            </pre>
            {children && (
              <div className="absolute top-2 right-2 flex items-center gap-2">
                {children}
              </div>
            )}
          </div>
        </div>
      </CodeBlockContext.Provider>
    )
  }

  return (
    <CodeBlockContext.Provider value={{ code }}>
      <div
        className={cn(
          'group relative w-full overflow-hidden rounded-md border bg-background text-foreground',
          className,
        )}
        {...props}
      >
        <div className="relative">
          <div
            className="overflow-hidden dark:hidden [&>pre]:m-0 [&>pre]:bg-background! [&>pre]:p-4 [&>pre]:text-foreground! [&>pre]:text-sm [&_code]:font-mono [&_code]:text-sm"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: "this is needed."
            dangerouslySetInnerHTML={{ __html: result?.light ?? '' }}
          />
          <div
            className="hidden overflow-hidden dark:block [&>pre]:m-0 [&>pre]:bg-background! [&>pre]:p-4 [&>pre]:text-foreground! [&>pre]:text-sm [&_code]:font-mono [&_code]:text-sm"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: "this is needed."
            dangerouslySetInnerHTML={{ __html: result?.dark ?? '' }}
          />
          {children && (
            <div className="absolute top-2 right-2 flex items-center gap-2">
              {children}
            </div>
          )}
        </div>
      </div>
    </CodeBlockContext.Provider>
  )
}

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
  onCopy?: () => void
  onError?: (error: Error) => void
  timeout?: number
}

/** @public */
export const CodeBlockCopyButton = ({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}: CodeBlockCopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false)
  const { code } = useContext(CodeBlockContext)

  const copyToClipboard = async () => {
    if (typeof window === 'undefined' || !navigator?.clipboard?.writeText) {
      onError?.(new Error('Clipboard API not available'))
      return
    }

    try {
      await navigator.clipboard.writeText(code)
      setIsCopied(true)
      onCopy?.()
      setTimeout(() => setIsCopied(false), timeout)
    } catch (error) {
      onError?.(error as Error)
    }
  }

  const Icon = isCopied ? CheckIcon : CopyIcon

  return (
    <Button
      className={cn('shrink-0', className)}
      onClick={copyToClipboard}
      size="icon"
      variant="ghost"
      {...props}
    >
      {children ?? <Icon size={14} />}
    </Button>
  )
}
