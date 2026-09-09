import { Layers } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { LayersPage } from './LayersPage'

export function LayersButton() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Layers for this site"
          aria-label="Layers for this site"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
        >
          <Layers className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[75vh] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto p-0"
      >
        <LayersPage compact />
      </PopoverContent>
    </Popover>
  )
}
