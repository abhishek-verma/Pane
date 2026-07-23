import { Github, Globe, Info } from 'lucide-react'
import type { FC } from 'react'
import { productRepositoryUrl } from '@/lib/constants/productUrls'

export const AboutSettingsPage: FC = () => {
  return (
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-8 duration-500">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">About Pane</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Pane is an open-source, AI-native browser designed for local-first
          agent workflows.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="space-y-4 rounded-md border border-border/50 bg-card p-5">
          <h2 className="font-medium text-base text-card-foreground">
            Project Details
          </h2>
          <div className="space-y-3 text-muted-foreground text-sm">
            <p>
              Pane executes AI agents directly within the browser ecosystem.
              Your data, keys, sessions, and documents never leave your local
              environment, ensuring total privacy.
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <a
                href={productRepositoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 font-medium text-[var(--accent-orange)] hover:underline"
              >
                <Github className="size-4" />
                <span>GitHub Repository</span>
              </a>
              <a
                href={productRepositoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 font-medium text-[var(--accent-orange)] hover:underline"
              >
                <Globe className="size-4" />
                <span>Project home</span>
              </a>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-md border border-border/50 bg-card p-5">
          <h2 className="font-medium text-base text-card-foreground">
            System Info
          </h2>
          <div className="space-y-2 font-mono text-muted-foreground text-xs">
            <div className="flex justify-between border-b pb-1.5">
              <span>App Version</span>
              <span className="font-bold text-foreground">v1.0.0</span>
            </div>
            <div className="flex justify-between border-b pb-1.5">
              <span>Environment</span>
              <span className="font-bold text-foreground">
                Local/Server-free
              </span>
            </div>
            <div className="flex justify-between border-b pb-1.5">
              <span>Licensing</span>
              <span className="font-bold text-foreground">AGPL-3.0</span>
            </div>
            <div className="flex justify-between pb-1">
              <span>Platform OS</span>
              <span className="font-bold text-foreground">
                macOS (intrinsic)
              </span>
            </div>
          </div>
        </section>
      </div>

      <div className="rounded-md border border-border/50 bg-muted/20 p-5 text-center text-muted-foreground text-xs">
        <Info className="mx-auto mb-2 size-4 text-muted-foreground" />
        Built with ❤️ for a private, autonomous web.
      </div>
    </div>
  )
}
