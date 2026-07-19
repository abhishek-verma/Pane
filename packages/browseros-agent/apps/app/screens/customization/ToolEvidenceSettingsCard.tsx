import type { FC } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useScreenshotPrefs } from '@/lib/tool-evidence/screenshot-prefs'

export const ToolEvidenceSettingsCard: FC = () => {
  const {
    showBrowserScreenshots,
    blurScreenshotsUntilClick,
    setShowBrowserScreenshots,
    setBlurScreenshotsUntilClick,
  } = useScreenshotPrefs()

  return (
    <div className="rounded-md border border-border bg-card p-6">
      <h3 className="mb-1 font-semibold text-lg">Tool evidence in chat</h3>
      <p className="mb-4 text-muted-foreground text-xs">
        Control how browser screenshots appear in agent tool cards.
      </p>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5 pr-4">
            <Label
              htmlFor="show-browser-screenshots"
              className="font-medium text-sm"
            >
              Show browser screenshots
            </Label>
            <p className="text-muted-foreground text-xs">
              When off, browser action cards show captions and page-diff
              summaries only.
            </p>
          </div>
          <Switch
            id="show-browser-screenshots"
            checked={showBrowserScreenshots}
            onCheckedChange={(checked) => {
              void setShowBrowserScreenshots(checked)
            }}
          />
        </div>

        <div className="flex items-center justify-between border-border border-t pt-4">
          <div className="space-y-0.5 pr-4">
            <Label
              htmlFor="blur-screenshots-until-click"
              className="font-medium text-sm"
            >
              Blur screenshots until click
            </Label>
            <p className="text-muted-foreground text-xs">
              Useful when screen-sharing. Click a thumbnail to reveal it and
              open the lightbox.
            </p>
          </div>
          <Switch
            id="blur-screenshots-until-click"
            checked={blurScreenshotsUntilClick}
            onCheckedChange={(checked) => {
              void setBlurScreenshotsUntilClick(checked)
            }}
            disabled={!showBrowserScreenshots}
          />
        </div>
      </div>
    </div>
  )
}
