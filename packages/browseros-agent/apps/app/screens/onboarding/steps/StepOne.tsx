import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod/v3'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  ONBOARDING_ABOUT_SUBMITTED_EVENT,
  ONBOARDING_STEP_COMPLETED_EVENT,
} from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'
import { onboardingProfileStorage } from '@/lib/onboarding/onboardingStorage'
import { personalizationStorage } from '@/lib/personalization/personalizationStorage'
import { type StepDirection, StepTransition } from './StepTransition'

export interface StepOneProps {
  direction: StepDirection
  onContinue: () => void
}

const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().min(1, 'Tell Pane a bit about you'),
})

type FormValues = z.infer<typeof formSchema>

export const StepOne = ({ direction, onContinue }: StepOneProps) => {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
    },
  })

  const handleSubmit = async (values: FormValues) => {
    const name = values.name.trim()
    const description = values.description.trim()

    await onboardingProfileStorage.setValue({
      name,
      description,
    })

    await personalizationStorage.setValue(
      [`Name: ${name}`, `About: ${description}`].join('\n'),
    )

    track(ONBOARDING_ABOUT_SUBMITTED_EVENT, {
      fields_filled: 2,
      has_name: true,
      has_role: false,
      has_company: false,
      has_description: true,
    })

    track(ONBOARDING_STEP_COMPLETED_EVENT, { step: 1, step_name: 'about' })
    onContinue()
  }

  return (
    <StepTransition direction={direction}>
      <div className="flex h-full flex-col items-center justify-center">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-2 text-center">
            <h2 className="font-bold text-3xl tracking-tight">
              Tell us about yourself
            </h2>
            <p className="text-base text-muted-foreground">
              Name and one line so Pane can address you like a person.
            </p>
          </div>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Your name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="What should we call you?"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>About you</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Engineer shipping a side project. Spend mornings in docs and evenings in PRs."
                        rows={3}
                        className="field-sizing-fixed"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full bg-[var(--accent-orange)] text-primary-foreground hover:bg-[var(--accent-orange)]/90"
              >
                Continue
              </Button>
            </form>
          </Form>
        </div>
      </div>
    </StepTransition>
  )
}
