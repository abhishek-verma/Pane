import { memo } from 'react'
import { Block, type BlockProps } from 'streamdown'
import { ViewportBlock } from './ViewportBlock'

// Use Streamdown's real parser and Block renderer. Splitting raw Markdown by
// character count corrupts fences, tables, lists, and reference links.
export const ViewportMarkdownBlock = memo(function ViewportMarkdownBlock(
  props: BlockProps,
) {
  const lines = Math.max(
    props.content.split('\n').length,
    Math.ceil(props.content.length / 80),
  )
  return (
    <ViewportBlock
      estimatedHeight={Math.max(28, lines * 22)}
      pinned={props.isIncomplete}
    >
      <Block {...props} />
    </ViewportBlock>
  )
})
