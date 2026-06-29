import {
  Anthropic,
  Azure,
  Bedrock,
  Cerebras,
  DeepSeek,
  Gemini,
  Kimi,
  LmStudio,
  Ollama,
  OpenAI,
  OpenRouter,
  Qwen,
} from '@lobehub/icons'
import { Bot, Github, Sparkles } from 'lucide-react'
import type { FC, SVGProps } from 'react'
import { PaneMark } from '@/components/branding/PaneMark'
import { PRODUCT_NAME } from '@/lib/constants/product'
import type { ProviderType } from './types'

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number | string
}

type IconComponent = FC<IconProps>

const providerIconMap: Record<ProviderType, IconComponent | null> = {
  anthropic: Anthropic,
  openai: OpenAI,
  'openai-compatible': OpenAI,
  google: Gemini,
  openrouter: OpenRouter,
  azure: Azure,
  ollama: Ollama,
  lmstudio: LmStudio,
  bedrock: Bedrock,
  browseros: null,
  moonshot: Kimi,
  'chatgpt-pro': OpenAI,
  'github-copilot': Github,
  'qwen-code': Qwen,
  codex: OpenAI,
  'claude-code': Anthropic,
  'acp-custom': null,
  'remote-hermes': Sparkles,
  cerebras: Cerebras,
  deepseek: DeepSeek,
}

export interface ProviderIconProps {
  type: ProviderType
  size?: number
  className?: string
}

/**
 * Provider icon component that renders the appropriate icon for each provider type
 * @public
 */
export const ProviderIcon: FC<ProviderIconProps> = ({
  type,
  size = 20,
  className,
}) => {
  const IconComponent = providerIconMap[type]

  if (IconComponent) {
    return <IconComponent size={size} className={className} />
  }

  return <Bot size={size} className={className} />
}

/**
 * Pane branded icon component
 * @public
 */
export const PaneIcon: FC<{ size?: number; className?: string }> = ({
  size = 20,
  className,
}) => {
  return (
    <PaneMark
      size={size}
      className={className}
      aria-label={PRODUCT_NAME}
      role="img"
    />
  )
}

/** @deprecated Use `PaneIcon` instead. */
export const BrowserOSIcon = PaneIcon
