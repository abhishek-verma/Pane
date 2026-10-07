import { type ReactNode, useState } from 'react'
import { ToolFullDetails } from './ToolFullDetails'

type Props = {
  conversationId: string
  toolCallId: string
  input: Record<string, unknown>
  previewed?: boolean
  onDeny?: () => void
  children: (input: Record<string, unknown>) => ReactNode
}

/** Executable approval controls are never mounted with preview arguments. */
export function ToolInputReview(props: Props) {
  if (!props.previewed) return props.children(props.input)
  return (
    <PreviewedInput
      key={`${props.conversationId}:${props.toolCallId}`}
      {...props}
    />
  )
}

function PreviewedInput(props: Props) {
  const [input, setInput] = useState<Record<string, unknown> | null>(null)
  if (input) return props.children(input)
  return (
    <div className="rounded-lg border p-3 text-sm">
      <p>Load full parameters to review this tool approval.</p>
      <pre className="agent-peek-scroll max-h-40 overflow-auto whitespace-pre-wrap text-xs">
        {JSON.stringify(props.input, null, 2)}
      </pre>
      <ToolFullDetails
        conversationId={props.conversationId}
        toolCallId={props.toolCallId}
        onLoaded={(details) => setInput(details.input)}
      />
      {props.onDeny ? (
        <button
          type="button"
          className="mt-2 text-xs underline"
          onClick={props.onDeny}
        >
          Deny
        </button>
      ) : null}
    </div>
  )
}
