/**
 * Demo media for the onboarding features page.
 *
 * Prefer local GIF imports from `@/assets/features/` for story moments.
 * Hosted demo videos can override GIFs when set.
 */

import meetingsGif from '@/assets/features/01-meetings.gif'
import personalisedInternetGif from '@/assets/features/02-personalised-internet.gif'
import researchGif from '@/assets/features/03-research.gif'
import workInMotionGif from '@/assets/features/04-work-in-motion.gif'
import developerCoworkGif from '@/assets/features/05-developer-cowork.gif'
import skillsGif from '@/assets/features/06-skills.gif'
import scopedContextGif from '@/assets/features/07-scoped-context.gif'
import paneAsMcpGif from '@/assets/features/08-pane-as-mcp.gif'

/**
 * @public
 */
export const PANE_INTRO_VIDEO_URL: string | undefined = undefined

/**
 * @public
 */
export const AGENT_MODE_DEMO_URL: string | undefined = undefined

/**
 * @public
 */
export const MCP_SERVER_DEMO_URL: string | undefined = undefined

/**
 * @public
 */
export const COWORK_DEMO_URL: string | undefined = undefined

/**
 * @public
 */
export const AGENTIC_CODING_DEMO_URL: string | undefined = undefined

/**
 * @public
 */
export const SCHEDULED_TASKS_DEMO_URL: string | undefined = undefined

/**
 * @public
 * @deprecated Use {@link PANE_INTRO_VIDEO_URL}
 */
export const BROWSER_OS_INTRO_VIDEO_URL = PANE_INTRO_VIDEO_URL

/**
 * @public
 */
export const QUICK_SEARCH_GIF_URL: string | undefined = undefined

/**
 * @public
 */
export const WORKFLOWS_DEMO_URL: string | undefined = undefined

/** Feature story GIFs (animated product moments). */
export const MEETING_CAPTURE_GIF_URL = meetingsGif
export const PERSONALISED_INTERNET_GIF_URL = personalisedInternetGif
export const RESEARCH_GIF_URL = researchGif
export const WORK_IN_MOTION_GIF_URL = workInMotionGif
export const DEVELOPER_COWORK_GIF_URL = developerCoworkGif
export const SKILLS_GIF_URL = skillsGif
export const SCOPED_CONTEXT_GIF_URL = scopedContextGif
export const PANE_AS_MCP_GIF_URL = paneAsMcpGif
