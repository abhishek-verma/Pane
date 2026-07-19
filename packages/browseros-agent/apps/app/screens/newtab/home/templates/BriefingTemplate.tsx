import { type FC, useState } from 'react'

export interface BriefingTemplateProps {
  content: string
}

export const BriefingTemplate: FC<BriefingTemplateProps> = ({ content }) => {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="space-y-2">
      <p
        className={`whitespace-pre-line text-muted-foreground text-xs leading-5 ${expanded ? '' : 'line-clamp-3'}`}
      >
        {content}
      </p>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="font-semibold text-[11px] text-[var(--accent-orange)] hover:underline"
      >
        {expanded ? 'Read less' : 'Read more'}
      </button>
    </div>
  )
}
