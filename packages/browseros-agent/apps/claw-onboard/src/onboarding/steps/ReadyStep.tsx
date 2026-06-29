import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DisplayHeading, Em, StepCopy } from '../components/DisplayHeading'
import { StarterPromptTile } from '../components/StarterPromptTile'
import { StepWrap } from '../components/StepWrap'
import { STARTER_PROMPTS } from '../onboarding-v2.helpers'

interface ReadyStepProps {
  onDone: () => void
}

/** Renders the final starter prompts and completion CTA. */
export function ReadyStep({ onDone }: ReadyStepProps) {
  return (
    <StepWrap>
      <DisplayHeading>
        You&rsquo;re <Em>set</Em>.
      </DisplayHeading>
      <StepCopy>
        Open Claude and try one of these. The task runs here, in Pane. You
        watch, approve, and audit.
      </StepCopy>
      <div className="mb-6 flex flex-col gap-2.5">
        {STARTER_PROMPTS.slice(0, 2).map((prompt) => (
          <StarterPromptTile key={prompt} prompt={prompt} />
        ))}
      </div>
      <Button type="button" size="lg" onClick={onDone}>
        <Sparkles className="size-4" />
        Open Pane
      </Button>
    </StepWrap>
  )
}
