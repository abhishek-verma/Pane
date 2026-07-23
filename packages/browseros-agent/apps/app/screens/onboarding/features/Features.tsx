import {
  ArrowDown,
  ArrowRight,
  Bot,
  CalendarClock,
  Code2,
  FolderOpen,
  KeyRound,
  LinkIcon,
  Lock,
  Plug,
} from 'lucide-react'
import { type FC, useEffect, useState } from 'react'
import DiscordLogo from '@/assets/discord-logo.svg'
import GithubLogo from '@/assets/github-logo.svg'
import SlackLogo from '@/assets/slack-logo.svg'
import { PaneMark } from '@/components/branding/PaneMark'
import { PillIndicator } from '@/components/elements/pill-indicator'
import { Button } from '@/components/ui/button'
import {
  AGENT_MODE_DEMO_URL,
  AGENTIC_CODING_DEMO_URL,
  COWORK_DEMO_URL,
  MCP_SERVER_DEMO_URL,
  PANE_INTRO_VIDEO_URL,
  SCHEDULED_TASKS_DEMO_URL,
} from '@/lib/constants/mediaUrls'
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@/lib/constants/product'
import {
  discordUrl,
  productRepositoryUrl,
  slackUrl,
} from '@/lib/constants/productUrls'
import { cn } from '@/lib/utils'
import { BentoCard, type Feature } from './BentoCard'
import { VideoFrame } from './VideoFrame'

const features: Feature[] = [
  {
    id: 'mcp-server',
    Icon: Plug,
    tag: 'DEV WEDGE',
    title: "Your coding agent's real browser",
    description:
      'Point Claude Code, Cursor, or Gemini CLI at Pane. One MCP URL. Your real session — localhost, logins, console — not a fake WebDriver tab.',
    detailedDescription:
      'Pane ships a built-in MCP server so AI coding agents drive the same browser you already use. Open tabs, click, type, screenshot, read the page, and pull console errors through natural language. No separate debug profile. No headless stand-in. Copy the URL from Settings → Pane as MCP and connect in one line.',
    highlights: [
      'One-line setup — `claude mcp add pane <url>` from Settings',
      'Real session — localhost, authenticated apps, your extensions',
      'Works with Claude Code, Cursor, Gemini CLI, Codex, and more',
      'Browser tools plus workspace access when you grant a folder',
    ],
    gridClass: 'md:col-span-2',
    videoUrl: MCP_SERVER_DEMO_URL,
  },
  {
    id: 'agent',
    Icon: Bot,
    tag: 'AGENT',
    title: 'Built-in AI agent',
    description:
      'Describe a task. Pane clicks, types, and navigates in the tabs you already have open.',
    detailedDescription:
      'Chat about the page you are on, or hand the agent a multi-step job. It works in your real browser session — the same logins, the same localhost, the same cookies. Everything stays on your machine. You bring the model (API key, OAuth subscription, or local).',
    highlights: [
      'Chat grounded in the current page',
      'Multi-step browser tasks — navigate, fill forms, extract data',
      'Runs locally with your own model credentials',
      'Pick up recent conversations from the Pane panel',
    ],
    gridClass: 'md:col-span-1',
    videoUrl: AGENT_MODE_DEMO_URL,
  },
  {
    id: 'cowork',
    Icon: FolderOpen,
    tag: 'WORKSPACE',
    title: 'Cowork: web + files + terminal',
    description:
      'Grant a folder. Research on the web, then write the report to disk — or run a command in that workspace.',
    detailedDescription:
      'Cowork lets the agent read and write files and run shell commands inside a folder you choose. Scrape a page and save a spreadsheet. Draft a markdown brief from a research thread. The agent is sandboxed to that folder and cannot touch the rest of your machine without another grant.',
    highlights: [
      'Read and write reports, spreadsheets, and markdown',
      'Run shell commands inside the granted folder',
      'Browser and local files in one task loop',
      'Sandboxed to the folder you select',
    ],
    gridClass: 'md:col-span-1',
    videoUrl: COWORK_DEMO_URL,
  },
  {
    id: 'agentic-coding',
    Icon: Code2,
    tag: 'DEV',
    title: 'Test, read errors, fix',
    description:
      'Claude Code opens your localhost app in Pane, finds the bug, and patches the code in one loop.',
    detailedDescription:
      'The developer loop Pane is built for: connect your coding agent, open the app you are shipping, reproduce the issue, read console and network failures, then fix the code without copy-pasting between terminal and browser. Same session you dogfood in. No separate automation browser.',
    highlights: [
      'Reproduce UI bugs in your real session',
      'Console and network errors available to the agent',
      'Screenshots when visual context helps',
      'Browser, repo, and shell as one workflow',
    ],
    gridClass: 'md:col-span-2',
    videoUrl: AGENTIC_CODING_DEMO_URL,
  },
  {
    id: 'your-models',
    Icon: KeyRound,
    tag: 'MODELS',
    title: 'Your models, your keys',
    description:
      'API key, ChatGPT Pro / Copilot / Qwen OAuth, or Ollama on your machine. No Pane account. No credits meter.',
    detailedDescription:
      'Pane does not force a hosted model or a Pane login. Connect the provider you already pay for, paste an API key, or point at a local runtime. Chat works well with lighter and local models. Agent mode wants a strong reasoning model — Claude Sonnet or Opus are good defaults.',
    highlights: [
      'OAuth for ChatGPT Pro, GitHub Copilot, and Qwen',
      'Bring your own API keys for major providers',
      'Local models via Ollama or LM Studio for Chat',
      'No required Pane account or hosted credits',
    ],
    gridClass: 'md:col-span-2',
  },
  {
    id: 'scheduled-tasks',
    Icon: CalendarClock,
    tag: 'AUTOMATION',
    title: 'Scheduled tasks, local',
    description:
      'Write a prompt once, set a cadence, and let the agent run it again — on your machine, not a Pane cloud cron.',
    detailedDescription:
      'Scheduled Tasks reuse the same agent that runs in your session. Daily briefings, recurring research pulls, or a Monday competitor scan — store the prompt, pick an interval, and Pane fires it when the browser is open. If the laptop was asleep, the task runs when you open Pane again.',
    highlights: [
      'Minute, hourly, or daily schedules',
      'Same agent tools as interactive chat',
      'Runs locally via the browser alarm system',
      'Catch up when Pane opens after sleep',
    ],
    gridClass: 'md:col-span-1',
    videoUrl: SCHEDULED_TASKS_DEMO_URL,
  },
  {
    id: 'local-first',
    Icon: Lock,
    tag: 'TRUST',
    title: 'Local-first by design',
    description:
      'Open source. Your browsing and agent work stay on your machine. No Pane servers required to use the product.',
    detailedDescription:
      'Pane is a Chromium fork under AGPL-3.0. Cloud sync, hosted inference, and usage metering from the upstream BrowserOS product are off in Pane builds. You can daily-drive it: import from Chrome, keep extensions, use vertical tabs, and run full uBlock Origin. The long game is memory, capture, and a browser that becomes yours — still local-first.',
    highlights: [
      'No Pane account required',
      'No Pane-operated cloud for core features',
      'Chrome import, extensions, vertical tabs, ad blocking',
      'Roadmap: memory, capture, adaptive home — on your machine',
    ],
    gridClass: 'md:col-span-3',
  },
]

const hasAnyFeatureMedia = features.some(
  (feature) => feature.videoUrl || feature.gifUrl,
)

/**
 * @public
 */
export const FeaturesPage: FC = () => {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleStart = async () => {
    const newtabUrl = chrome.runtime.getURL('app.html#/home')
    const [currentTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    })
    await chrome.tabs.create({ url: newtabUrl })
    if (currentTab.id) {
      await chrome.tabs.remove(currentTab.id)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <section className="relative border-border/40 border-b">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div className="space-y-10 text-center">
            <div className="space-y-6">
              <PillIndicator
                text="WELCOME"
                className={`transition-all delay-100 duration-700 ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
              />

              <div
                className={cn(
                  'flex justify-center transition-all delay-150 duration-700',
                  mounted ? 'scale-100 opacity-100' : 'scale-95 opacity-0',
                )}
              >
                <PaneMark size={56} className="text-[var(--accent-orange)]" />
              </div>

              <div className="space-y-4">
                <p
                  className={cn(
                    'font-medium text-[var(--accent-orange)] text-sm uppercase tracking-[0.2em]',
                    'transition-all delay-200 duration-700',
                    mounted
                      ? 'translate-y-0 opacity-100'
                      : 'translate-y-4 opacity-0',
                  )}
                >
                  {PRODUCT_TAGLINE}
                </p>
                <h1
                  className={cn(
                    'font-bold text-4xl leading-tight tracking-tight md:text-5xl',
                    'transition-all delay-200 duration-700 md:text-7xl',
                    mounted ? 'scale-100 opacity-100' : 'scale-95 opacity-0',
                  )}
                >
                  Why switch to{' '}
                  <span className="text-[var(--accent-orange)]">
                    {PRODUCT_NAME}?
                  </span>
                </h1>
                <p
                  className={cn(
                    'mx-auto max-w-2xl text-lg text-muted-foreground leading-relaxed',
                    'transition-all delay-300 duration-700',
                    mounted
                      ? 'translate-y-0 opacity-100'
                      : 'translate-y-4 opacity-0',
                  )}
                >
                  An open-source browser where the agent is native to your
                  session. Your tabs, your files, your models. No Pane account.
                  No Pane cloud.
                </p>
              </div>
            </div>

            {PANE_INTRO_VIDEO_URL ? (
              <VideoFrame
                title={`${PRODUCT_NAME} demo`}
                className={cn(
                  'transition-all delay-500 duration-700',
                  mounted
                    ? 'translate-y-0 opacity-100'
                    : 'translate-y-4 opacity-0',
                )}
              >
                <video
                  className="h-full w-full"
                  src={PANE_INTRO_VIDEO_URL}
                  title={`${PRODUCT_NAME} demonstration`}
                  autoPlay
                  muted
                  loop
                  playsInline
                  controls
                />
              </VideoFrame>
            ) : (
              <div
                className={cn(
                  'mx-auto grid max-w-3xl gap-6 text-left sm:grid-cols-3 sm:gap-8',
                  'transition-all delay-500 duration-700',
                  mounted
                    ? 'translate-y-0 opacity-100'
                    : 'translate-y-4 opacity-0',
                )}
              >
                {[
                  {
                    title: 'Agent in the browser',
                    body: 'Not a sidebar glued onto Chrome. Not a remote daemon.',
                  },
                  {
                    title: 'Developer wedge',
                    body: 'MCP for Claude Code and Cursor against your real session.',
                  },
                  {
                    title: 'Local-complete',
                    body: 'BYOK, cowork, schedules — without Pane servers.',
                  },
                ].map((item) => (
                  <div key={item.title} className="space-y-1.5">
                    <p className="font-semibold text-sm">{item.title}</p>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      {item.body}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          className={cn(
            'animation-duration-[3s] absolute bottom-0.5 left-1/2 flex -translate-x-1/2 animate-bounce flex-col items-center gap-3',
            'transition-opacity delay-[2000ms] duration-700',
            mounted ? 'opacity-100' : 'opacity-0',
          )}
        >
          <div className="text-center">
            <p className="mb-2 font-medium text-muted-foreground text-xs">
              Scroll for features
            </p>
            <ArrowDown className="mx-auto h-6 w-6 text-[var(--accent-orange)]" />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 md:py-20">
        <div className="mb-12 space-y-3 text-center">
          <p className="font-semibold text-muted-foreground text-xs uppercase tracking-widest">
            FEATURES
          </p>
          <h2 className="font-bold text-3xl tracking-tight md:text-4xl">
            What you can use{' '}
            <span className="text-[var(--accent-orange)]">today</span>
          </h2>
          <p className="mx-auto max-w-2xl text-muted-foreground">
            The foundation that ships now. Memory, capture, and a browser that
            becomes yours over time are what we are building next.
          </p>
        </div>

        {mounted && (
          <div className="grid gap-4 md:grid-cols-3">
            {features.map((feature, index) => (
              <BentoCard
                key={feature.id}
                feature={feature}
                mounted={mounted}
                index={index}
              />
            ))}
          </div>
        )}

        <div className="mt-8 text-center">
          <p className="text-muted-foreground text-sm">
            {hasAnyFeatureMedia
              ? 'Tip: click any card for a walkthrough with video and deeper detail'
              : 'Tip: click any card for the full story and highlights'}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl border-border/40 border-y px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 flex items-center gap-3">
            <LinkIcon className="h-6 w-6 text-[var(--accent-orange)]" />
            <h2 className="font-bold text-3xl">
              Follow the build and shape{' '}
              <span className="text-[var(--accent-orange)]">
                {PRODUCT_NAME}
              </span>
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {discordUrl ? (
              <a
                href={discordUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="community-card group flex items-start gap-4 rounded-xl border border-border bg-card p-6 transition-all hover:-translate-y-1 hover:border-[var(--accent-orange)]/50 hover:bg-card/80 hover:shadow-[var(--accent-orange)]/5 hover:shadow-lg"
              >
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg transition-all group-hover:scale-110">
                  <img
                    src={DiscordLogo}
                    className="h-full w-full"
                    alt="discord-logo"
                  />
                </div>
                <div className="space-y-1">
                  <h3 className="font-semibold text-lg transition-colors group-hover:text-[var(--accent-orange)]">
                    Join Discord
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    Suggest features and share feedback
                  </p>
                </div>
              </a>
            ) : null}

            {slackUrl ? (
              <a
                href={slackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="community-card group flex items-start gap-4 rounded-xl border border-border bg-card p-6 transition-all hover:-translate-y-1 hover:border-[var(--accent-orange)]/50 hover:bg-card/80 hover:shadow-[var(--accent-orange)]/5 hover:shadow-lg"
              >
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg transition-all group-hover:scale-110">
                  <img
                    src={SlackLogo}
                    className="h-full w-full"
                    alt="slack-logo"
                  />
                </div>
                <div className="space-y-1">
                  <h3 className="font-semibold text-lg transition-colors group-hover:text-[var(--accent-orange)]">
                    Join Slack
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    Suggest features and share feedback
                  </p>
                </div>
              </a>
            ) : null}

            <a
              href={productRepositoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="community-card group flex items-start gap-4 rounded-xl border border-border bg-card p-6 transition-all hover:-translate-y-1 hover:border-[var(--accent-orange)]/50 hover:bg-card/80 hover:shadow-[var(--accent-orange)]/5 hover:shadow-lg md:col-span-2"
            >
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-foreground/10 transition-all group-hover:scale-110 group-hover:bg-foreground/20">
                <img
                  src={GithubLogo}
                  className="h-full w-full"
                  alt="github-logo"
                />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-lg transition-colors group-hover:text-[var(--accent-orange)]">
                  GitHub
                </h3>
                <p className="text-muted-foreground text-sm">
                  Source, docs, specs, and releases — star it, open issues, or
                  contribute
                </p>
              </div>
            </a>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pt-16 pb-56">
        <div className="space-y-4 text-center">
          <Button
            onClick={handleStart}
            size="lg"
            className="bg-[var(--accent-orange)] text-white shadow-[var(--accent-orange)]/25 shadow-lg hover:bg-[var(--accent-orange)]/90"
          >
            Start using {PRODUCT_NAME}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>
    </div>
  )
}
