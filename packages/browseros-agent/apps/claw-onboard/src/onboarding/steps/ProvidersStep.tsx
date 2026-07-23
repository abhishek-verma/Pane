import { ArrowRight, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DisplayHeading, Em, StepCopy } from '../components/DisplayHeading'
import { SkipLaterButton } from '../components/SkipLaterButton'
import { StepWrap } from '../components/StepWrap'

interface ProvidersStepProps {
  onContinue: () => void
  onSkip: () => void
}

/** Offers model/provider setup with a clear path to defer to Settings. */
export function ProvidersStep({ onContinue, onSkip }: ProvidersStepProps) {
  return (
    <StepWrap>
      <DisplayHeading>
        Add a <Em>model</Em>.
      </DisplayHeading>
      <StepCopy>
        Pane needs a model to chat and run agents. Connect ChatGPT Pro, Claude,
        Gemini, an API key, or a local runtime like Ollama — all from Settings →
        AI. Nothing leaves your machine unless you choose a cloud provider.
      </StepCopy>
      <div className="mb-4 rounded-xl border border-border-2 bg-card p-4 text-[12.5px] text-ink-2 leading-[1.5]">
        <div className="mb-1 font-bold text-[13px] text-ink">Recommended</div>
        Start with an OAuth subscription you already pay for, then fall back to
        BYOK or local models. Agent mode works best with a strong reasoning
        model.
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="lg" onClick={onContinue}>
          <KeyRound className="size-4" />
          Continue
          <ArrowRight className="size-4" />
        </Button>
        <SkipLaterButton onClick={onSkip} />
      </div>
    </StepWrap>
  )
}
