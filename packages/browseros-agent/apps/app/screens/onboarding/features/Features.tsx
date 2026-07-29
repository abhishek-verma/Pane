import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Bot,
  Brain,
  FolderOpen,
  Home,
  LinkIcon,
  Lock,
  Mic,
  Plug,
  Sparkles,
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
  COWORK_DEMO_URL,
  DEVELOPER_COWORK_GIF_URL,
  JOB_APPLICANT_GIF_URL,
  MCP_SERVER_DEMO_URL,
  MEETING_CAPTURE_GIF_URL,
  MORNING_BRIEFING_GIF_URL,
  PANE_AS_MCP_GIF_URL,
  PANE_INTRO_VIDEO_URL,
  PROFILES_GIF_URL,
  RESEARCH_GIF_URL,
  SKILLS_GIF_URL,
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

/** Pane-only capabilities — the reason the fork exists. */
const uniqueFeatures: Feature[] = [
  {
    id: 'soul',
    Icon: Sparkles,
    tag: 'THE THESIS',
    title: 'A browser with a soul',
    description:
      'Not the same chatbot for every user. Pane takes a shape that fits your life — persona, memory, capture, and skills that compound on your machine until the browser stops feeling generic.',
    detailedDescription:
      'The soul is the combination that makes Pane yours: a persona that can be chief of staff, job-search partner, or research buddy; memory grounded in what you actually browsed and did, not only what you typed into chat; meetings and research captured in the tab so they do not evaporate; skills written when you repeat a workflow, staged for your approval; context scoped into profiles so work and personal life stay apart; a homepage that rearranges around your day. Chief of staff if you are building a company. Job-search partner if you are looking for what is next. Research buddy if you are learning. Whatever else you need — because Pane learns your rhythms and grows more personal every week you use it. All local. No Pane cloud profile.',
    highlights: [
      'Persona that fits the role you need right now — editable and switchable',
      'Memory from real activity: tabs, files, terminal, meetings, research threads',
      'Skills that appear when you repeat work successfully — you approve before they run',
      'Capture that stays in the browser: meeting notes without a bot, research that survives the tab close',
      'Profiles so work, job hunt, and personal life do not bleed into each other',
      'A home and agent that get more useful the longer you use Pane',
    ],
    gridClass: 'md:col-span-3',
    gifUrl: PROFILES_GIF_URL,
  },
  {
    id: 'learning-loop',
    Icon: Brain,
    tag: 'ONLY IN PANE',
    title: 'Gets smarter from how you work',
    description:
      'Pane watches real browsing, files, and terminal activity (with consent) and turns repeat work into memory and skills — not just chat transcripts.',
    detailedDescription:
      'Most agents only remember what you typed into a chat. Pane learns from what you actually did: the dashboard you open every Monday, the export path you always take, the conventions in your repo. Facts land in plain local memory files. Repeated workflows become staged skills you can approve. Nothing auto-activates without you. The loop runs on your machine — no Pane cloud required.',
    highlights: [
      'Activity-grounded memory — from browsing and work, not only conversation',
      'Auto-proposed skills from workflows you repeat',
      'Staged for your review — you approve before a skill goes live',
      'Open files you can read, edit, and delete anytime',
    ],
    gridClass: 'md:col-span-2',
    gifUrl: SKILLS_GIF_URL,
  },
  {
    id: 'meeting-capture',
    Icon: Mic,
    tag: 'ONLY IN PANE',
    title: 'Meeting notes without a bot',
    description:
      'Meet, Zoom, or Teams in a tab? Pane records and transcribes locally. No Otter bot joining the call. No vendor cloud recording.',
    detailedDescription:
      'Because Pane is the browser, web meetings already live in a tab. Capture tab audio (and your mic if you allow it), transcribe on-device with a local speech model, and file notes in a meeting profile the agent can recall later. Per-domain consent, a visible recording indicator, one click to stop or delete. Optional BYOK to a provider transcription API if you want speed — never through a Pane server.',
    highlights: [
      'Native tab capture — no third-party bot in the meeting',
      'Local transcription by default (faster-whisper class)',
      'Summaries, decisions, and action items on your machine',
      'Ask later: "what did we decide about X last week?"',
    ],
    gridClass: 'md:col-span-1',
    gifUrl: MEETING_CAPTURE_GIF_URL,
  },
  {
    id: 'browsing-learnings',
    Icon: BookOpen,
    tag: 'ONLY IN PANE',
    title: 'Research that survives the tab close',
    description:
      'Opt in and Pane threads the pages you open toward a question — quotes, sources, and a chain you can turn into an outline later.',
    detailedDescription:
      'Research is multi-tab and multi-day. Pane’s research profile records the chain of pages (not a flat history), keeps verbatim quotes for citable retrieval, and lets you ask for a lit review or outline with links back to the source tabs. Broader browsing learnings can extract facts and workflow fragments from domains you allow. Everything is off by default, pauseable, and scoped into profiles so work does not bleed into personal life.',
    highlights: [
      'Research threads with source URLs and timestamps',
      'Verbatim quotes so claims stay citable',
      'Browsing learnings feed memory and skill proposals',
      'Profiles: Work, Personal, Research, Meetings — separate scopes',
    ],
    gridClass: 'md:col-span-1',
    gifUrl: RESEARCH_GIF_URL,
  },
  {
    id: 'adaptive-home',
    Icon: Home,
    tag: 'ONLY IN PANE',
    title: 'A homepage that becomes yours',
    description:
      'New tab is the front door to your private web — composer plus doorways into living sites, not a static link grid.',
    detailedDescription:
      'Pane’s home is the homepage of your Personalised Internet. Doorways surface Job Search, Research, and other living sites with a short pulse line. Today continuity points at the next action. Ask in the composer to create or reshape a site; depth stays on the site, not as a dashboard of cards.',
    highlights: [
      'Composer stays on home for the next ask',
      'Doorways into living sites with pulse lines',
      'Today continuity for the next real action',
      'Empty home offers site starters, not widget kits',
    ],
    gridClass: 'md:col-span-2',
    gifUrl: MORNING_BRIEFING_GIF_URL,
  },
]

/** Shared substrate (also in BrowserOS) — still useful, secondary on this page. */
const foundationFeatures: Feature[] = [
  {
    id: 'mcp-server',
    Icon: Plug,
    tag: 'MCP',
    title: "Your coding agent's real browser",
    description:
      'Point Claude Code or Cursor at Pane. One MCP URL. Localhost, logins, console — your real session.',
    detailedDescription:
      'Pane ships a built-in MCP server so coding agents drive the browser you already use. Open tabs, click, type, screenshot, read the page, pull console errors. No separate debug profile. Copy the URL from Settings → Pane as MCP and connect in one line.',
    highlights: [
      'One-line setup from Settings',
      'Real session — not a fake WebDriver tab',
      'Works with Claude Code, Cursor, Gemini CLI, Codex',
      'Pairs with workspace access when you grant a folder',
    ],
    gridClass: 'md:col-span-2',
    videoUrl: MCP_SERVER_DEMO_URL,
    gifUrl: PANE_AS_MCP_GIF_URL,
  },
  {
    id: 'agent',
    Icon: Bot,
    tag: 'AGENT',
    title: 'Built-in AI agent',
    description:
      'Describe a task. Pane clicks, types, and navigates in the tabs you already have open.',
    detailedDescription:
      'Chat about the page you are on, or hand the agent a multi-step job in your real session. You bring the model — API key, OAuth subscription, or local. No Pane account. No credits meter.',
    highlights: [
      'Chat grounded in the current page',
      'Multi-step browser automation',
      'Your models, your keys',
      'Scheduled tasks run the same agent locally',
    ],
    gridClass: 'md:col-span-1',
    videoUrl: AGENT_MODE_DEMO_URL,
    gifUrl: JOB_APPLICANT_GIF_URL,
  },
  {
    id: 'cowork',
    Icon: FolderOpen,
    tag: 'WORKSPACE',
    title: 'Web + files + terminal',
    description:
      'Grant a folder. Research online, write the report to disk, run a command — sandboxed to what you allowed.',
    detailedDescription:
      'Cowork lets the agent read and write files and run shell commands inside a folder you choose. Browser and machine in one loop. Sandboxed to that folder.',
    highlights: [
      'Read and write local files',
      'Shell inside the granted folder',
      'Browser and disk in one task',
      'You pick the sandbox boundary',
    ],
    gridClass: 'md:col-span-2',
    videoUrl: COWORK_DEMO_URL,
    gifUrl: DEVELOPER_COWORK_GIF_URL,
  },
  {
    id: 'local-first',
    Icon: Lock,
    tag: 'TRUST',
    title: 'Local-first by design',
    description:
      'Open source. Capture, memory, and agent work stay on your machine. No Pane servers required.',
    detailedDescription:
      'Pane is AGPL-3.0. Upstream BrowserOS cloud surfaces — sync, hosted inference, credits — are off in Pane builds. Consent for capture is off by default. Memory and skills are plain files. Import Chrome, keep extensions, use vertical tabs and full uBlock Origin.',
    highlights: [
      'No Pane account required',
      'Capture and memory stay local',
      'Consent off by default, per-domain controls',
      'Chrome import, extensions, daily-driver Chromium',
    ],
    gridClass: 'md:col-span-1',
  },
]

const allFeatures = [...uniqueFeatures, ...foundationFeatures]

const hasAnyFeatureMedia = allFeatures.some(
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
                  A browser that{' '}
                  <span className="text-[var(--accent-orange)]">
                    becomes yours
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
                  Pane is not another chat sidebar. It learns from how you work,
                  captures meetings in the tab (no bot), and keeps memory on
                  your machine — beyond what a generic agentic browser offers.
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
                    title: 'Learns continuously',
                    body: 'Memory and skills from real activity, not only chat.',
                  },
                  {
                    title: 'Captures natively',
                    body: 'Meetings and research in-tab — no Otter, no extra app.',
                  },
                  {
                    title: 'Stays local',
                    body: 'No Pane account. No Pane cloud for core features.',
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
            WHY PANE
          </p>
          <h2 className="font-bold text-3xl tracking-tight md:text-4xl">
            What only <span className="text-[var(--accent-orange)]">Pane</span>{' '}
            does
          </h2>
          <p className="mx-auto max-w-2xl text-muted-foreground">
            A browser with a soul: persona, memory, capture, and skills that
            compound — because the agent <em>is</em> the browser, not a guest in
            it.
          </p>
        </div>

        {mounted && (
          <div className="grid gap-4 md:grid-cols-3">
            {uniqueFeatures.map((feature, index) => (
              <BentoCard
                key={feature.id}
                feature={feature}
                mounted={mounted}
                index={index}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mx-auto max-w-7xl border-border/40 border-t px-6 py-16 md:py-20">
        <div className="mb-12 space-y-3 text-center">
          <p className="font-semibold text-muted-foreground text-xs uppercase tracking-widest">
            ALSO SHIPS
          </p>
          <h2 className="font-bold text-3xl tracking-tight md:text-4xl">
            Agent, MCP, and workspace{' '}
            <span className="text-[var(--accent-orange)]">foundation</span>
          </h2>
          <p className="mx-auto max-w-2xl text-muted-foreground">
            The daily-driver substrate: drive your real browser from Claude
            Code, automate tasks, grant a folder, bring your own model.
          </p>
        </div>

        {mounted && (
          <div className="grid gap-4 md:grid-cols-3">
            {foundationFeatures.map((feature, index) => (
              <BentoCard
                key={feature.id}
                feature={feature}
                mounted={mounted}
                index={index + uniqueFeatures.length}
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
