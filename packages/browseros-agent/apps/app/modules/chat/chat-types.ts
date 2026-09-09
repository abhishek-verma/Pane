export type ChatMode = 'chat' | 'agent'

export interface Suggestion {
  display: string
  prompt: string
  icon: string
}

export const CHAT_SUGGESTIONS: Suggestion[] = [
  {
    display: 'Summarize this page',
    prompt: 'Read the current tab and summarize it in bullet points',
    icon: '✨',
  },
  {
    display: 'What topics does this page talk about?',
    prompt:
      'Read the current tab and briefly describe what it is about in 1-2 lines',
    icon: '🔍',
  },
  {
    display: 'Extract comments from this page',
    prompt: 'Read the current tab and extract comments as bullet points',
    icon: '💬',
  },
]

export const AGENT_SUGGESTIONS: Suggestion[] = [
  {
    display: 'Compare my open tabs',
    prompt:
      'Compare the pages I attach. Explain the key differences and cite your sources.',
    icon: '↗',
  },
  {
    display: 'Turn this page into a plan',
    prompt:
      'Read this page and turn it into a practical plan with clear next steps.',
    icon: '↗',
  },
  {
    display: 'Review a screenshot or file',
    prompt:
      'Review the attachment and help me improve it. Start with the most important issues.',
    icon: '↗',
  },
]
