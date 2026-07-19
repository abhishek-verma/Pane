import { CREATE_PREVIEW_MAX_BYTES, type FileChangeDetail } from './types'

function countDiffStats(lines: string[]): {
  additions: number
  deletions: number
} {
  let additions = 0
  let deletions = 0
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }
  return { additions, deletions }
}

function extractDiffBody(outputText: string): string[] {
  const marker = '\n\n'
  const idx = outputText.indexOf(marker)
  const body = idx >= 0 ? outputText.slice(idx + marker.length) : outputText
  const lines = body.split('\n').filter((l) => l.length > 0)
  const looksLikeDiff = lines.some(
    (l) => l.startsWith('+') || l.startsWith('-'),
  )
  return looksLikeDiff ? lines : []
}

function isProbablyBinary(content: string): boolean {
  if (content.includes('\u0000')) return true
  const sample = content.slice(0, 8000)
  let bad = 0
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i)
    if (code < 9 || (code > 13 && code < 32)) bad++
  }
  return sample.length > 0 && bad / sample.length > 0.1
}

export function buildFileChangeDetail(args: {
  toolName: string
  input: Record<string, unknown>
  outputText: string
  isError: boolean
}): FileChangeDetail | null {
  if (args.isError) return null
  const path =
    typeof args.input.path === 'string' ? args.input.path : '(unknown path)'

  if (args.toolName === 'filesystem_edit') {
    let diffLines = extractDiffBody(args.outputText)
    if (diffLines.length === 0) {
      const oldS =
        typeof args.input.old_string === 'string' ? args.input.old_string : ''
      const newS =
        typeof args.input.new_string === 'string' ? args.input.new_string : ''
      if (oldS === newS) {
        return {
          path,
          kind: 'empty',
          additions: 0,
          deletions: 0,
          diffLines: [],
        }
      }
      diffLines = [
        ...oldS.split('\n').map((l) => `- ${l}`),
        ...newS.split('\n').map((l) => `+ ${l}`),
      ]
    }
    const stats = countDiffStats(diffLines)
    if (stats.additions === 0 && stats.deletions === 0) {
      return { path, kind: 'empty', ...stats, diffLines }
    }
    return { path, kind: 'edit', ...stats, diffLines }
  }

  if (args.toolName === 'filesystem_write') {
    const content =
      typeof args.input.content === 'string' ? args.input.content : ''
    const bytesMatch = args.outputText.match(/Wrote\s+(\d+)\s+bytes/i)
    const bytesWritten = bytesMatch
      ? Number(bytesMatch[1])
      : new TextEncoder().encode(content).length

    if (isProbablyBinary(content)) {
      return {
        path,
        kind: 'binary',
        bytesWritten,
        diffLines: [],
        omitFullContent: true,
        omitReason: 'Binary or non-text content',
      }
    }
    if (content.length > CREATE_PREVIEW_MAX_BYTES) {
      return {
        path,
        kind: 'overwrite',
        bytesWritten,
        diffLines: [],
        omitFullContent: true,
        omitReason: `Content is ${bytesWritten} bytes; full body omitted in chat`,
      }
    }
    const diffLines = content.split('\n').map((l) => `+ ${l}`)
    return {
      path,
      kind: 'create',
      bytesWritten,
      additions: diffLines.length,
      deletions: 0,
      diffLines,
    }
  }

  return null
}

export function formatFileStats(file: FileChangeDetail): string {
  if (file.kind === 'binary') return 'binary'
  if (file.omitFullContent && file.bytesWritten != null) {
    const kb = file.bytesWritten / 1024
    return kb >= 1
      ? `wrote ${kb.toFixed(1)} KB`
      : `wrote ${file.bytesWritten} B`
  }
  if (file.kind === 'empty') return 'no textual change'
  if (file.additions != null || file.deletions != null) {
    return `+${file.additions ?? 0} −${file.deletions ?? 0}`
  }
  return ''
}
