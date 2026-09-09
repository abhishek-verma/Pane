import { useRef, useState } from 'react'
import { useAvailableTabs } from '@/components/elements/available-tabs.hooks'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

/** Capture only the selected browser viewport; crop the reviewed image locally. */
export function ScreenshotCapture({
  onAttach,
  onClose,
}: {
  onAttach: (files: File[]) => void
  onClose: () => void
}) {
  const { tabs } = useAvailableTabs({ enabled: true })
  const [chosenTab, setChosenTab] = useState<number>()
  const [image, setImage] = useState<string>()
  const [error, setError] = useState<string>()
  const [area, setArea] = useState<{
    x: number
    y: number
    width: number
    height: number
  }>()
  const [capturing, setCapturing] = useState(false)
  const imageRef = useRef<HTMLImageElement>(null)
  const start = useRef<{ x: number; y: number } | undefined>(undefined)
  async function capture() {
    setCapturing(true)
    setError(undefined)
    try {
      const [active] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      const tab = chosenTab
        ? tabs.find((item) => item.id === chosenTab)
        : active?.url?.match(/^https?:/)
          ? active
          : tabs[0]
      if (!tab?.id) throw new Error('Open a web page to capture.')
      let data: string
      try {
        if (active?.id !== tab.id) {
          await chrome.tabs.update(tab.id, { active: true })
          await new Promise((resolve) => setTimeout(resolve, 150))
        }
        data = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: 'png',
        })
      } finally {
        if (active?.id && active.id !== tab.id)
          await chrome.tabs.update(active.id, { active: true }).catch(() => {})
      }
      setImage(data)
      setArea(undefined)
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not capture this page.',
      )
    } finally {
      setCapturing(false)
    }
  }
  async function attach() {
    if (!image || !imageRef.current) return
    try {
      let blob: Blob
      const element = imageRef.current
      if (area && area.width > 0.005 && area.height > 0.005) {
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(area.width * element.naturalWidth)
        canvas.height = Math.round(area.height * element.naturalHeight)
        canvas
          .getContext('2d')
          ?.drawImage(
            element,
            area.x * element.naturalWidth,
            area.y * element.naturalHeight,
            canvas.width,
            canvas.height,
            0,
            0,
            canvas.width,
            canvas.height,
          )
        blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) =>
              value
                ? resolve(value)
                : reject(new Error('Could not crop screenshot')),
            'image/png',
          ),
        )
      } else blob = await (await fetch(image)).blob()
      onAttach([
        new File(
          [blob],
          `Screenshot ${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
          { type: 'image/png' },
        ),
      ])
      onClose()
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not attach screenshot',
      )
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogTitle>Take screenshot</DialogTitle>
        <p className="text-muted-foreground text-sm">
          Capture the current page, then drag over the preview to select an
          area. Your draft stays intact.
        </p>
        {!image && (
          <label className="space-y-1 text-sm">
            <span>Page to capture</span>
            <select
              aria-label="Page to capture"
              value={chosenTab ?? ''}
              onChange={(event) =>
                setChosenTab(Number(event.target.value) || undefined)
              }
              className="block w-full rounded-lg border bg-background p-2"
            >
              <option value="">Current web page</option>
              {tabs.map((tab) => (
                <option key={tab.id} value={tab.id}>
                  {tab.title || tab.url}
                </option>
              ))}
            </select>
          </label>
        )}
        {image && (
          <div
            className="relative select-none self-center overflow-hidden rounded-lg"
            style={{ touchAction: 'none' }}
            onPointerDown={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              start.current = {
                x: (event.clientX - rect.left) / rect.width,
                y: (event.clientY - rect.top) / rect.height,
              }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              if (!start.current) return
              const rect = event.currentTarget.getBoundingClientRect()
              const x = Math.max(
                0,
                Math.min(1, (event.clientX - rect.left) / rect.width),
              )
              const y = Math.max(
                0,
                Math.min(1, (event.clientY - rect.top) / rect.height),
              )
              setArea({
                x: Math.min(x, start.current.x),
                y: Math.min(y, start.current.y),
                width: Math.abs(x - start.current.x),
                height: Math.abs(y - start.current.y),
              })
            }}
            onPointerUp={() => {
              start.current = undefined
            }}
          >
            <img
              ref={imageRef}
              src={image}
              alt="Screenshot preview. Drag to select an area."
              draggable={false}
              className="max-h-[55vh] w-full object-contain"
            />
            {area && (
              <div
                className="pointer-events-none absolute border-2 border-white bg-white/10 ring-1 ring-black/70"
                style={{
                  left: `${area.x * 100}%`,
                  top: `${area.y * 100}%`,
                  width: `${area.width * 100}%`,
                  height: `${area.height * 100}%`,
                }}
              />
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={capture}
            disabled={capturing}
            className="rounded-lg px-3 py-2 text-sm hover:bg-muted"
          >
            {capturing
              ? 'Capturing…'
              : image
                ? 'Retake'
                : 'Capture current page'}
          </button>
          {image && (
            <button
              type="button"
              onClick={attach}
              className="rounded-lg bg-foreground px-3 py-2 text-background text-sm"
            >
              Attach {area ? 'selected area' : 'screenshot'}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
