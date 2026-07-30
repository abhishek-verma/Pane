import {
  ArrowRight,
  BookOpen,
  Bot,
  Brain,
  Check,
  Clock3,
  FolderOpen,
  Github,
  Globe2,
  Lock,
  type LucideIcon,
  MessageCircle,
  Plug,
  Sparkles,
} from 'lucide-react'
import type { FC } from 'react'
import { PaneMark } from '@/components/branding/PaneMark'
import { Button } from '@/components/ui/button'
import {
  AGENT_MODE_DEMO_URL,
  COWORK_DEMO_URL,
  DEVELOPER_COWORK_GIF_URL,
  MCP_SERVER_DEMO_URL,
  MEETING_CAPTURE_GIF_URL,
  PANE_AS_MCP_GIF_URL,
  PERSONALISED_INTERNET_GIF_URL,
  SCOPED_CONTEXT_GIF_URL,
  SKILLS_GIF_URL,
  WORK_IN_MOTION_GIF_URL,
} from '@/lib/constants/mediaUrls'
import {
  PRODUCT_NAME,
  PRODUCT_SIGNATURE,
  PRODUCT_TAGLINE,
} from '@/lib/constants/product'
import { discordUrl, productRepositoryUrl } from '@/lib/constants/productUrls'
import { cn } from '@/lib/utils'

interface StoryFeature {
  id: string
  Icon: LucideIcon
  tag: string
  title: string
  description: string
  detailedDescription: string
  highlights: string[]
  videoUrl?: string
  gifUrl?: string
}

const outcomeFeatures: StoryFeature[] = [
  {
    id: 'continuity',
    Icon: BookOpen,
    tag: 'REMEMBERS',
    title: 'What mattered stays',
    description:
      'Close the tabs. The decisions, sources, and unfinished thread can still be there when you return.',
    detailedDescription:
      'Continuity starts at the source. Pane can capture supported web meetings visibly and transcribe them locally after a one-time model download. Opt-in research mode threads pages, quotes, sources, and timestamps toward one question. Both are off until you enable them, domain-specific, and pauseable.',
    highlights: [
      'Meeting capture without a bot joining the call',
      'Local transcription after a one-time model download',
      'Opt-in research threads with citable sources',
      'Ask later what was decided and where it came from',
    ],
    gifUrl: MEETING_CAPTURE_GIF_URL,
  },
  {
    id: 'personalised-internet',
    Icon: Globe2,
    tag: 'PERSONALISED INTERNET',
    title: 'Your work becomes a living web',
    description:
      'Turn ongoing work into private sites with structure, state, and a next action instead of leaving it buried in chats.',
    detailedDescription:
      'Home is the front door to your Personalised Internet: a composer plus doorways into living sites. Start with a Job Search pipeline, Research Hub, or Sales Pipeline, then ask Pane to create, update, or reshape it. The agent writes structured, inspectable data and approved UI patterns rather than arbitrary generated HTML.',
    highlights: [
      'Private sites for work that lasts days or weeks',
      'Doorways from Home with continuity and pulse',
      'Structured local data with an inspectable write path',
      'Job Search, Research Hub, and Sales Pipeline starters',
    ],
    gifUrl: PERSONALISED_INTERNET_GIF_URL,
  },
  {
    id: 'work-in-motion',
    Icon: Clock3,
    tag: 'CONTINUES',
    title: 'Work moves while you are away',
    description:
      'Schedule a successful task, step away, and return to the result or an approval request.',
    detailedDescription:
      'Scheduled tasks reuse the local agent and can run while Pane is running. Results return to Home and the schedule history. Pane stops before consequential actions such as sending a message. If the browser is fully quit or the machine is asleep, browser work waits.',
    highlights: [
      'Local recurring schedules',
      'Results surfaced when you return',
      'Approval before consequential actions',
      'Browser tasks require Pane to be running',
    ],
    gifUrl: WORK_IN_MOTION_GIF_URL,
  },
  {
    id: 'learning-loop',
    Icon: Brain,
    tag: 'STAGED',
    title: 'Gets better at your work',
    description:
      'Editable local memory and staged skill drafts let useful parts of prior work carry into the next task.',
    detailedDescription:
      'Pane keeps plain local memory files you can inspect, edit, or delete. Repeated successful tool runs can produce a proposed skill, but the workflow is deliberately staged: the draft waits for review and does not activate itself. This is the early foundation for a deeper learning loop.',
    highlights: [
      'SOUL.md, USER.md, and MEMORY.md stay editable',
      'Skill candidates come from repeated successful runs',
      'Drafts remain staged until you review them',
      'The full self-improving loop is still maturing',
    ],
    gifUrl: SKILLS_GIF_URL,
  },
  {
    id: 'scoped-context',
    Icon: Sparkles,
    tag: 'CONTROL',
    title: 'Context without blurred boundaries',
    description:
      'Profiles, context buckets, and personas each control a different layer of what Pane can carry forward.',
    detailedDescription:
      'Browser profiles provide hard separation for cookies, history, private sites, memory, and skills. Context buckets tune what Pane retrieves within a profile. Personas tune role and voice. Keeping these controls separate makes the boundary visible instead of hiding it behind fixed labels.',
    highlights: [
      'Browser profiles for hard separation',
      'Context buckets for retrieval scope',
      'Personas for role and voice',
      'All local, visible, and editable',
    ],
    gifUrl: SCOPED_CONTEXT_GIF_URL,
  },
]

const developerFeatures: StoryFeature[] = [
  {
    id: 'mcp-server',
    Icon: Plug,
    tag: 'MCP',
    title: "Your coding agent's real browser",
    description:
      'Point Claude Code, Cursor, or Codex at Pane. One MCP URL gives it localhost, logins, tabs, screenshots, and console output.',
    detailedDescription:
      'Pane ships a built-in MCP server so coding agents drive the browser you already use. Open tabs, click, type, screenshot, read the page, and pull console errors without a separate debug profile. Copy the URL from Settings → Pane as MCP and connect in one line.',
    highlights: [
      'One-line setup from Settings',
      'Your authenticated session, not a WebDriver tab',
      'Works with Claude Code, Cursor, Codex, and other MCP clients',
      'Pairs with workspace access when you grant a folder',
    ],
    videoUrl: MCP_SERVER_DEMO_URL,
    gifUrl: PANE_AS_MCP_GIF_URL,
  },
  {
    id: 'cowork',
    Icon: FolderOpen,
    tag: 'WORKSPACE',
    title: 'Browser, files, and terminal in one loop',
    description:
      'Grant a folder. Reproduce the bug in the browser, inspect the console, write the fix, and verify it without stitching tools together.',
    detailedDescription:
      'Cowork lets the agent read and write files and run shell commands inside a folder you choose. Browser and machine stay in one task, while the workspace boundary remains explicit.',
    highlights: [
      'Read and write local files',
      'Shell inside the granted folder',
      'Browser and disk in one task',
      'You choose the sandbox boundary',
    ],
    videoUrl: COWORK_DEMO_URL,
    gifUrl: DEVELOPER_COWORK_GIF_URL,
  },
  {
    id: 'agent',
    Icon: Bot,
    tag: 'AGENT',
    title: 'A native agent in your real session',
    description:
      'Describe a task. Pane can navigate, click, type, and extract in the tabs you already have open.',
    detailedDescription:
      'Chat about the current page or hand the agent a multi-step job in your real browser session. Bring an API key, an OAuth subscription, or a local model. There is no required Pane account or credits meter.',
    highlights: [
      'Chat grounded in the current page',
      'Multi-step browser automation',
      'Your models and your keys',
      'The same local agent powers scheduled tasks',
    ],
    videoUrl: AGENT_MODE_DEMO_URL,
  },
  {
    id: 'local-first',
    Icon: Lock,
    tag: 'TRUST',
    title: 'Local-first by design',
    description:
      'Capture, memory, private sites, and agent work stay on your machine. The core product needs no Pane server.',
    detailedDescription:
      'Pane is AGPL-3.0. Upstream cloud surfaces such as sync, hosted inference, and credits are off in Pane builds. Capture consent is off by default, memory and skills are readable files, and you can bring your existing Chrome data and extensions.',
    highlights: [
      'No Pane account required',
      'Capture and memory stay local',
      'Consent off by default with per-domain controls',
      'Chrome import and extension compatibility',
    ],
  },
]

const outcomes = [
  [
    '01',
    'REMEMBERS THE THREAD',
    'Meetings, research, and decisions survive the tab close.',
  ],
  [
    '02',
    'BUILDS YOUR PERSONALISED INTERNET',
    'Ongoing projects become private, living sites.',
  ],
  [
    '03',
    'KEEPS WORK MOVING',
    'Local schedules return results and stop for approval.',
  ],
] as const

interface StoryProps {
  feature: StoryFeature
  index: number
  sectionNumber: string
}

const Story: FC<StoryProps> = ({ feature, index, sectionNumber }) => {
  const { Icon } = feature
  const media = feature.videoUrl || feature.gifUrl
  const mediaFirst = index % 2 === 1

  return (
    <article id={feature.id} className="border-border border-t">
      <div className="mx-auto grid max-w-7xl lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div
          className={cn(
            'flex flex-col justify-between gap-10 px-6 py-14 md:px-10 md:py-20 lg:px-14',
            mediaFirst && 'lg:order-2',
          )}
        >
          <div className="space-y-8">
            <div className="flex items-center justify-between border-border border-b pb-4">
              <div className="flex items-center gap-3 font-mono text-muted-foreground text-xs tracking-[0.12em]">
                <span className="text-[var(--signal)]">{sectionNumber}</span>
                <span>{feature.tag}</span>
              </div>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>

            <div className="space-y-4">
              <h3 className="max-w-xl font-semibold text-3xl tracking-[-0.035em] md:text-5xl">
                {feature.title}
              </h3>
              <p className="max-w-xl text-lg text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>

            <p className="max-w-xl leading-7">{feature.detailedDescription}</p>
          </div>

          <ul className="grid gap-x-8 gap-y-3 border-border border-t pt-6 sm:grid-cols-2">
            {feature.highlights.map((highlight) => (
              <li
                key={highlight}
                className="flex items-start gap-3 text-muted-foreground text-sm leading-5"
              >
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--signal)]" />
                <span>{highlight}</span>
              </li>
            ))}
          </ul>
        </div>

        <div
          className={cn(
            'flex min-h-[360px] items-center border-border bg-muted/30 p-6 md:min-h-[520px] md:p-10 lg:border-l lg:p-14',
            mediaFirst && 'lg:order-1 lg:border-r lg:border-l-0',
          )}
        >
          {feature.videoUrl ? (
            <div className="w-full overflow-hidden rounded-[6px] border border-border bg-background">
              <video
                className="aspect-video h-full w-full object-contain"
                src={feature.videoUrl}
                title={feature.title}
                autoPlay
                muted
                loop
                playsInline
                controls
              />
            </div>
          ) : feature.gifUrl ? (
            <div className="w-full overflow-hidden rounded-[6px] border border-border bg-white">
              <img
                className="aspect-video h-full w-full object-contain"
                src={feature.gifUrl}
                alt={feature.title}
              />
            </div>
          ) : (
            <div className="w-full border-border border-y py-16 text-center">
              <Icon className="mx-auto mb-6 h-10 w-10 text-[var(--signal)]" />
              <p className="font-mono text-muted-foreground text-xs tracking-[0.14em]">
                {feature.tag} · BUILT INTO PANE
              </p>
            </div>
          )}
          {!media ? null : (
            <span className="sr-only">
              {feature.title} visual demonstration
            </span>
          )}
        </div>
      </div>
    </article>
  )
}

/**
 * @public
 */
export const FeaturesPage: FC = () => {
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
    <div className="min-h-screen bg-background text-foreground">
      <header>
        <div className="border-border border-b">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6 font-mono text-muted-foreground text-xs tracking-[0.12em]">
            <div className="flex items-center gap-3">
              <PaneMark size={22} className="text-[var(--signal)]" />
              <span>PANE / FEATURES</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-[var(--signal)]" />
              <span className="hidden sm:inline">
                OPEN SOURCE · LOCAL-FIRST
              </span>
              <span className="sm:hidden">LOCAL</span>
            </div>
          </div>
        </div>

        <div className="mx-auto grid min-h-[620px] max-w-7xl lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
          <div className="flex flex-col justify-center gap-10 px-6 py-16 md:px-10 lg:px-14">
            <div className="space-y-6">
              <p className="font-mono text-[var(--signal)] text-xs tracking-[0.16em]">
                {PRODUCT_SIGNATURE.toUpperCase()}
              </p>
              <h1 className="max-w-4xl font-semibold text-5xl leading-[0.96] tracking-[-0.055em] md:text-7xl lg:text-[82px]">
                {PRODUCT_TAGLINE}
              </h1>
              <p className="max-w-2xl text-lg text-muted-foreground leading-8 md:text-xl">
                Pane remembers the thread, learns your routines, and gets better
                as you work. Not a collection of AI features. A browser that
                compounds into continuity, private places, and work in motion.
              </p>
            </div>

            <div>
              <Button
                onClick={handleStart}
                size="lg"
                className="rounded-[6px] bg-[var(--signal)] text-primary-foreground shadow-none hover:bg-[var(--signal)]/90"
              >
                Start using {PRODUCT_NAME}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-col justify-center border-border border-t px-6 py-12 md:px-10 lg:border-t-0 lg:border-l lg:px-12">
            <p className="mb-8 font-mono text-muted-foreground text-xs tracking-[0.14em]">
              THE SYSTEM / THREE OUTCOMES
            </p>
            {outcomes.map(([number, title, body]) => (
              <div
                key={number}
                className="grid grid-cols-[44px_1fr] gap-4 border-border border-t py-7 last:border-b"
              >
                <span className="font-mono text-[var(--signal)] text-xs">
                  {number}
                </span>
                <div className="space-y-2">
                  <p className="font-mono text-xs tracking-[0.1em]">{title}</p>
                  <p className="text-muted-foreground text-sm leading-6">
                    {body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main>
        <section>
          <div className="border-border border-y">
            <div className="mx-auto grid max-w-7xl gap-6 px-6 py-10 md:grid-cols-[160px_1fr] md:px-10 lg:px-14">
              <p className="font-mono text-muted-foreground text-xs tracking-[0.14em]">
                01 / THE PRODUCT
              </p>
              <div className="max-w-3xl">
                <h2 className="font-semibold text-3xl tracking-[-0.035em] md:text-5xl">
                  See what changes in your week
                </h2>
                <p className="mt-4 text-muted-foreground leading-7">
                  No teaser cards and no hidden walkthroughs. The product,
                  current behavior, and limits are visible below.
                </p>
              </div>
            </div>
          </div>

          {outcomeFeatures.map((feature, index) => (
            <Story
              key={feature.id}
              feature={feature}
              index={index}
              sectionNumber={`0${index + 1}`}
            />
          ))}
        </section>

        <section>
          <div className="border-border border-y bg-muted/30">
            <div className="mx-auto grid max-w-7xl gap-6 px-6 py-10 md:grid-cols-[160px_1fr] md:px-10 lg:px-14">
              <p className="font-mono text-muted-foreground text-xs tracking-[0.14em]">
                02 / DEVELOPER PROOF
              </p>
              <div className="max-w-3xl">
                <h2 className="font-semibold text-3xl tracking-[-0.035em] md:text-5xl">
                  One loop from browser to code
                </h2>
                <p className="mt-4 text-muted-foreground leading-7">
                  Drive your authenticated browser from a coding agent, or give
                  Pane a workspace and let the same task cross tabs, files, and
                  terminal.
                </p>
              </div>
            </div>
          </div>

          {developerFeatures.map((feature, index) => (
            <Story
              key={feature.id}
              feature={feature}
              index={index}
              sectionNumber={`0${index + 1}`}
            />
          ))}
        </section>

        <section className="border-border border-y">
          <div className="mx-auto max-w-7xl px-6 py-16 md:px-10 lg:px-14">
            <div className="grid gap-10 lg:grid-cols-[0.7fr_1.3fr]">
              <div>
                <p className="font-mono text-muted-foreground text-xs tracking-[0.14em]">
                  03 / THE BOUNDARY
                </p>
                <h2 className="mt-4 font-semibold text-3xl tracking-[-0.035em] md:text-5xl">
                  Ambitious, without pretending
                </h2>
              </div>
              <div className="grid border-border border-t sm:grid-cols-2">
                {[
                  [
                    'CAPTURE',
                    'Opt-in, domain-specific, visible, and pauseable.',
                  ],
                  [
                    'SKILLS',
                    'Proposed drafts stay staged until you review them.',
                  ],
                  [
                    'SCHEDULES',
                    'Browser work needs Pane running and the machine awake.',
                  ],
                  [
                    'CONTEXT',
                    'Profiles, buckets, and personas remain distinct controls.',
                  ],
                ].map(([label, body], index) => (
                  <div
                    key={label}
                    className={cn(
                      'border-border border-b py-6 sm:px-6',
                      index % 2 === 1 && 'sm:border-l',
                    )}
                  >
                    <p className="font-mono text-[var(--signal)] text-xs tracking-[0.12em]">
                      {label}
                    </p>
                    <p className="mt-3 text-muted-foreground text-sm leading-6">
                      {body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-border border-b">
          <div className="mx-auto max-w-7xl px-6 py-16 md:px-10 lg:px-14">
            <div className="mb-10">
              <p className="font-mono text-muted-foreground text-xs tracking-[0.14em]">
                04 / BUILD WITH US
              </p>
              <h2 className="mt-4 font-semibold text-3xl tracking-[-0.035em] md:text-5xl">
                Follow the build and shape Pane
              </h2>
            </div>

            <div className="grid border-border border-t md:grid-cols-2">
              {discordUrl ? (
                <a
                  href={discordUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center justify-between border-border border-b py-7 md:border-r md:px-6"
                >
                  <div className="flex items-center gap-4">
                    <MessageCircle className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Discord</p>
                      <p className="mt-1 text-muted-foreground text-sm">
                        Ask questions and share feedback
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </a>
              ) : null}

              <a
                href={productRepositoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-between border-border border-b py-7 md:px-6"
              >
                <div className="flex items-center gap-4">
                  <Github className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">GitHub</p>
                    <p className="mt-1 text-muted-foreground text-sm">
                      Source, specs, issues, and releases
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </a>
            </div>

            <div className="mt-12 flex flex-col items-start justify-between gap-6 border-border border-t pt-8 sm:flex-row sm:items-center">
              <div>
                <p className="font-mono text-muted-foreground text-xs tracking-[0.12em]">
                  OPEN SOURCE · LOCAL-FIRST · YOUR MODELS · YOUR MACHINE
                </p>
                <p className="mt-3 text-muted-foreground text-sm">
                  {PRODUCT_SIGNATURE}.
                </p>
              </div>
              <Button
                onClick={handleStart}
                size="lg"
                className="rounded-[6px] bg-[var(--signal)] text-primary-foreground shadow-none hover:bg-[var(--signal)]/90"
              >
                Start using {PRODUCT_NAME}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
