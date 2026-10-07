import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Streamdown } from 'streamdown'
import { MessageContentReader } from '../components/tool-evidence/MessageContentReader'
import { ToolFullDetails } from '../components/tool-evidence/ToolFullDetails'
import { ToolInputReview } from '../components/tool-evidence/ToolInputReview'
import { ViewportBlock } from '../components/tool-evidence/ViewportBlock'
import { ViewportMarkdownBlock } from '../components/tool-evidence/ViewportMarkdownBlock'

function Tool({ index }: { index: number }) {
  useEffect(() => {
    document.documentElement.dataset.mounts = String(
      Number(document.documentElement.dataset.mounts ?? 0) + 1,
    )
    return () => {
      document.documentElement.dataset.unmounts = String(
        Number(document.documentElement.dataset.unmounts ?? 0) + 1,
      )
    }
  }, [])
  return (
    <div data-tool={index} style={{ height: 32 }}>
      Tool step {index}: complete <button type="button">Inspect</button>
    </div>
  )
}
const markdown = [
  '# Complete research answer',
  '*r/samsung (285 comments)*',
  ...Array.from(
    { length: 200 },
    (_, i) =>
      `Research paragraph ${i}: ${'The answer remains complete. '.repeat(12)}`,
  ),
  '```text\nA complete code fence.\n\nStill inside the fence.\n```',
  '| Phone | Result |\n| --- | --- |\n| S25 Ultra | Complete |',
  '## Final conclusion',
  '**This is the complete final answer.**',
].join('\n\n')

const root = document.getElementById('root')
if (!root) throw new Error('Missing fixture root')
createRoot(root).render(
  <main>
    <h1>A single long turn</h1>
    {Array.from({ length: 1000 }, (_, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: static tool IDs in an immutable fixture
      <div key={`tool-${index}`} id={`tool-${index}`}>
        <ViewportBlock estimatedHeight={32}>
          <Tool index={index} />
        </ViewportBlock>
      </div>
    ))}
    <section id="answer">
      <Streamdown
        mode="streaming"
        parseIncompleteMarkdown={false}
        BlockComponent={ViewportMarkdownBlock}
      >
        {markdown}
      </Streamdown>
    </section>
    <section id="approval">
      <ToolInputReview
        conversationId="chat"
        toolCallId="approval"
        input={{ content: 'PREVIEW ONLY' }}
        previewed
      >
        {(input) => (
          <button
            type="button"
            data-approve
            onClick={() => {
              document.documentElement.dataset.approvedInput =
                JSON.stringify(input)
            }}
          >
            Approve exact input
          </button>
        )}
      </ToolInputReview>
    </section>
    <section id="turn-reader">
      <MessageContentReader conversationId="chat" messageId="long-turn" />
    </section>
    <section id="details">
      <ToolFullDetails conversationId="chat" toolCallId="call" />
    </section>
  </main>,
)
