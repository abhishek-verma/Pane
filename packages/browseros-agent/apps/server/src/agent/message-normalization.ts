import { AGENT_LIMITS } from '@browseros/shared/constants/limits'
import { LLM_PROVIDERS } from '@browseros/shared/schemas/llm'
import type {
  FilePart,
  ImagePart,
  ModelMessage,
  ToolModelMessage,
  ToolResultPart,
  UserContent,
  UserModelMessage,
} from 'ai'
import { stripToolResultOutput } from './compaction/content'
import type { ResolvedAgentConfig } from './types'

type ToolResultOutput = ToolResultPart['output']
type ToolResultContentPart = Extract<
  ToolResultOutput,
  { type: 'content' }
>['value'][number]
type UserMessagePart = Exclude<UserContent, string>[number]
type UserMediaPart = Extract<UserMessagePart, ImagePart | FilePart>

export interface MessageNormalizationOptions {
  supportsImages: boolean
  supportsMediaInToolResults: boolean
  /**
   * Maximum number of images that may appear across the full conversation
   * history before the model call. When set, oldest images are stripped
   * first until the total is within the cap. Bedrock enforces a hard
   * 20-image limit per Converse API request; exceeding it returns 400.
   */
  maxImages?: number
  /**
   * When true, a synthetic empty assistant message is inserted between a
   * trailing `tool` message and the following `user` message. Required for
   * Bedrock: its Converse API groups consecutive `tool` + `user` messages
   * into one user block, producing mixed `[toolResult, text]` content that
   * it then rejects with HTTP 400.
   */
  separateToolAndUserMessages?: boolean
}

// See how opencode handles, inspiration from there
// https://github.com/anomalyco/opencode/blob/5ec5d1daceaab23c8ffa9ae32b40f53120f4609e/packages/opencode/src/session/message-v2.ts#L503-L522
function supportsToolResultMediaTransport(
  config: ResolvedAgentConfig,
): boolean {
  switch (config.provider) {
    case LLM_PROVIDERS.ANTHROPIC:
    case LLM_PROVIDERS.OPENAI:
    case LLM_PROVIDERS.AZURE:
    case LLM_PROVIDERS.BEDROCK:
      return true
    case LLM_PROVIDERS.GOOGLE: {
      const modelId = config.model.toLowerCase()
      return modelId.includes('gemini-3') && !modelId.includes('gemini-2')
    }
    case LLM_PROVIDERS.BROWSEROS:
      return (
        config.upstreamProvider === LLM_PROVIDERS.ANTHROPIC ||
        config.upstreamProvider === LLM_PROVIDERS.AZURE
      )
    default:
      return false
  }
}

export function getMessageNormalizationOptions(
  config: ResolvedAgentConfig,
): MessageNormalizationOptions {
  return {
    supportsImages: config.supportsImages !== false,
    supportsMediaInToolResults: supportsToolResultMediaTransport(config),
    ...(config.provider === LLM_PROVIDERS.BEDROCK && {
      maxImages: AGENT_LIMITS.BEDROCK_MAX_IMAGES,
      separateToolAndUserMessages: true,
    }),
  }
}

function buildToolResultMediaLabel(parts: UserMediaPart[]): string {
  const imageCount = parts.filter(
    (part) =>
      part.type === 'image' ||
      (part.type === 'file' && part.mediaType.startsWith('image/')),
  ).length

  if (imageCount === parts.length) {
    return 'Attached image(s) from tool result:'
  }

  if (imageCount === 0) {
    return 'Attached file(s) from tool result:'
  }

  return 'Attached files from tool result:'
}

function toolResultContentPartToUserMedia(
  part: ToolResultContentPart,
): UserMediaPart | null {
  switch (part.type) {
    case 'media':
    case 'image-data':
      if (part.mediaType.startsWith('image/')) {
        return {
          type: 'image',
          image: part.data,
          mediaType: part.mediaType,
        }
      }
      return {
        type: 'file',
        data: part.data,
        mediaType: part.mediaType,
      }
    case 'file-data':
      if (part.mediaType.startsWith('image/')) {
        return {
          type: 'image',
          image: part.data,
          mediaType: part.mediaType,
        }
      }
      return {
        type: 'file',
        data: part.data,
        mediaType: part.mediaType,
        filename: part.filename,
      }
    default:
      return null
  }
}

function normalizeToolMessageForModel(
  message: ToolModelMessage,
  supportsImages: boolean,
): ModelMessage[] {
  let extractedMedia: UserMediaPart[] = []
  let changed = false

  const content = message.content.map((part) => {
    if (part.type !== 'tool-result' || part.output.type !== 'content') {
      return part
    }

    changed = true

    if (supportsImages) {
      extractedMedia = [
        ...extractedMedia,
        ...part.output.value
          .map(toolResultContentPartToUserMedia)
          .filter(
            (mediaPart): mediaPart is UserMediaPart => mediaPart !== null,
          ),
      ]
    }

    return {
      ...part,
      output: stripToolResultOutput(part.output),
    }
  })

  if (!changed) {
    return [message]
  }

  const normalizedToolMessage: ToolModelMessage = {
    ...message,
    content,
  }

  if (extractedMedia.length === 0) {
    return [normalizedToolMessage]
  }

  const mediaMessage: UserModelMessage = {
    role: 'user',
    content: [
      {
        type: 'text',
        text: buildToolResultMediaLabel(extractedMedia),
      },
      ...extractedMedia,
    ],
  }

  return [normalizedToolMessage, mediaMessage]
}

/**
 * Count the total number of image parts across all tool-result messages.
 * Used to enforce per-provider image caps (e.g. Bedrock's 20-image limit).
 */
function countImagesInToolResults(messages: ModelMessage[]): number {
  let count = 0
  for (const message of messages) {
    if (message.role !== 'tool') continue
    for (const part of message.content) {
      if (part.type !== 'tool-result' || part.output.type !== 'content')
        continue
      for (const contentPart of part.output.value) {
        if (
          (contentPart.type === 'image-data' ||
            contentPart.type === 'media' ||
            contentPart.type === 'file-data') &&
          contentPart.mediaType.startsWith('image/')
        ) {
          count++
        }
      }
    }
  }
  return count
}

/**
 * Strip images from the oldest tool-result messages first until the total
 * image count across the conversation is within `maxImages`. Returns the
 * original array reference unchanged if no stripping was needed.
 */
function applyImageCap(
  messages: ModelMessage[],
  maxImages: number,
): ModelMessage[] {
  let totalImages = countImagesInToolResults(messages)
  if (totalImages <= maxImages) return messages

  const result: ModelMessage[] = [...messages]
  for (let i = 0; i < result.length && totalImages > maxImages; i++) {
    const msg = result[i]
    if (msg.role !== 'tool') continue

    let msgChanged = false
    const newContent = msg.content.map((part) => {
      if (
        part.type !== 'tool-result' ||
        part.output.type !== 'content' ||
        totalImages <= maxImages
      ) {
        return part
      }

      const imageCount = part.output.value.filter(
        (p) =>
          (p.type === 'image-data' ||
            p.type === 'media' ||
            p.type === 'file-data') &&
          p.mediaType.startsWith('image/'),
      ).length

      if (imageCount === 0) return part

      msgChanged = true
      totalImages -= imageCount
      return {
        ...part,
        output: stripToolResultOutput(part.output),
      }
    })

    if (msgChanged) {
      result[i] = { ...msg, content: newContent }
    }
  }

  return result
}

/**
 * Bedrock's `groupIntoBlocks` merges consecutive `tool` + `user` role messages
 * into a single Bedrock user block. This produces `[toolResult, text]` mixed
 * content which Bedrock rejects with HTTP 400. Fix: insert a synthetic empty
 * assistant message between the last tool message and the following user message
 * so they land in separate Bedrock blocks.
 */
function separateToolAndUserMessages(messages: ModelMessage[]): ModelMessage[] {
  let changed = false
  const result: ModelMessage[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    result.push(msg)

    // When a `tool` message is followed by a `user` message, insert a
    // filler assistant message so Bedrock sees them as distinct blocks.
    if (
      msg.role === 'tool' &&
      i + 1 < messages.length &&
      messages[i + 1].role === 'user'
    ) {
      result.push({
        role: 'assistant',
        content: [{ type: 'text', text: '...' }],
      })
      changed = true
    }
  }

  return changed ? result : messages
}

// opencode handles this at message serialization time for providers that do not
// reliably support media inside tool results. BrowserOS uses the same boundary:
// normalize model messages before the next step, not inside the screenshot tool.
export function normalizeMessagesForModel(
  messages: ModelMessage[],
  options: MessageNormalizationOptions,
): ModelMessage[] {
  // Apply the per-provider image cap first (independent of transport mode).
  // Bedrock accepts images natively in tool results but imposes a 20-image
  // hard limit per request — strip oldest images before sending.
  const afterImageCap =
    options.maxImages != null
      ? applyImageCap(messages, options.maxImages)
      : messages

  // Bedrock merges consecutive tool+user role messages into one block,
  // producing mixed [toolResult, text] content it then rejects with 400.
  // Insert a synthetic empty assistant turn to force separate blocks.
  const result = options.separateToolAndUserMessages
    ? separateToolAndUserMessages(afterImageCap)
    : afterImageCap

  if (options.supportsMediaInToolResults) {
    return result
  }

  let changed = result !== messages
  const normalized: ModelMessage[] = []

  for (const message of result) {
    if (message.role !== 'tool') {
      normalized.push(message)
      continue
    }

    const replacement = normalizeToolMessageForModel(
      message,
      options.supportsImages,
    )
    if (replacement.length !== 1 || replacement[0] !== message) {
      changed = true
    }
    normalized.push(...replacement)
  }

  return changed ? normalized : messages
}
