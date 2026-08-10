import { type FC, useEffect, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  PINNABLE_CLASSES,
  type PinnableClass,
  requireBrowserInputApprovalStorage,
  type TrustPinRecord,
  type TrustPinsMap,
  trustPinsStorage,
} from '@/lib/trust/trust-pins-storage'

const CLASS_LABELS: Record<PinnableClass, string> = {
  'write-local': 'Workspace file writes',
  system: 'Terminal commands',
  'write-external': 'External browser actions',
  spend: 'Payments and purchases',
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export const TrustPinsSettings: FC = () => {
  const [pins, setPins] = useState<TrustPinsMap>({})
  const [requireBrowserInput, setRequireBrowserInput] = useState(false)

  useEffect(() => {
    trustPinsStorage.getValue().then((value) => setPins(value ?? {}))
    requireBrowserInputApprovalStorage
      .getValue()
      .then((value) => setRequireBrowserInput(Boolean(value)))
    const unwatchPins = trustPinsStorage.watch((value) => setPins(value ?? {}))
    const unwatchInput = requireBrowserInputApprovalStorage.watch((value) =>
      setRequireBrowserInput(Boolean(value)),
    )
    return () => {
      unwatchPins()
      unwatchInput()
    }
  }, [])

  const updatePin = async (
    cls: PinnableClass,
    patch: Partial<TrustPinRecord>,
  ) => {
    const next: TrustPinsMap = { ...(await trustPinsStorage.getValue()) }
    const current = next[cls] ?? { pinned: false }
    next[cls] = { ...current, ...patch }
    if (!next[cls]?.pinned) {
      delete next[cls]
    }
    await trustPinsStorage.setValue(next)
  }

  return (
    <div className="space-y-4 rounded-md border bg-card p-4">
      <div>
        <h2 className="font-medium text-base">Trust pins</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Pin a consequence class to reduce approval prompts. Pins expire after
          seven days by default.
        </p>
      </div>
      <div className="flex flex-col gap-3 border-t pt-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="require-browser-input">Clicks and typing</Label>
            <p className="mt-1 text-muted-foreground text-xs">
              On by default — the browser agent can click and type without
              asking. Payment pages still always require approval.
            </p>
          </div>
          <Switch
            id="require-browser-input"
            checked={!requireBrowserInput}
            onCheckedChange={(checked) => {
              const requireApproval = !checked
              setRequireBrowserInput(requireApproval)
              void requireBrowserInputApprovalStorage.setValue(requireApproval)
            }}
          />
        </div>
      </div>
      {PINNABLE_CLASSES.map((cls) => {
        const pin = pins[cls]
        return (
          <div
            key={cls}
            className="flex flex-col gap-3 border-t pt-4 first:border-t-0 first:pt-0"
          >
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor={`pin-${cls}`}>{CLASS_LABELS[cls]}</Label>
              <Switch
                id={`pin-${cls}`}
                checked={Boolean(pin?.pinned)}
                onCheckedChange={(checked) =>
                  updatePin(cls, {
                    pinned: checked,
                    expiresAt: checked ? Date.now() + SEVEN_DAYS_MS : undefined,
                  })
                }
              />
            </div>
            {pin?.pinned && pin.expiresAt != null && (
              <p className="text-muted-foreground text-xs">
                Expires {new Date(pin.expiresAt).toLocaleString()}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
