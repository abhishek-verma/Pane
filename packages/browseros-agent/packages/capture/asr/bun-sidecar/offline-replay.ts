#!/usr/bin/env bun
/**
 * Offline ASR replay against a saved stream.webm.
 * Usage:
 *   bun packages/capture/asr/bun-sidecar/offline-replay.ts /path/to/stream.webm
 */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'

const streamPath = resolve(
  process.argv[2] ??
    `${process.env.HOME}/.browseros/capture/default/meetings/6bfd0447-b53b-40f8-9b59-d98175b8c6dd/audio-chunks/stream.webm`,
)
const sidecar = resolve(import.meta.dir, 'sidecar.ts')
const sessionId = `replay-${Date.now()}`

const child = spawn('bun', [sidecar], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    BROWSEROS_ASR_MOCK: '',
  },
})

const finals: string[] = []
let ready = false
let lastAck = -1

child.stderr.on('data', (d) => {
  process.stderr.write(d)
})

const rl = createInterface({ input: child.stdout })
const waiters = new Map<string, () => void>()

function waitFor(kind: string): Promise<void> {
  return new Promise((resolveWait) => {
    waiters.set(kind, resolveWait)
  })
}

rl.on('line', (line) => {
  if (!line.trim()) return
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(line) as Record<string, unknown>
  } catch {
    return
  }
  if (msg.kind === 'ready') {
    ready = true
    waiters.get('ready')?.()
    waiters.delete('ready')
  }
  if (msg.kind === 'ack') {
    lastAck = Number(msg.sequence ?? -1)
    waiters.get('ack')?.()
    waiters.delete('ack')
  }
  if (msg.kind === 'final' && typeof msg.text === 'string') {
    finals.push(msg.text)
    console.log(`FINAL: ${msg.text}`)
  }
})

function send(obj: Record<string, unknown>): void {
  child.stdin.write(`${JSON.stringify(obj)}\n`)
}

async function feed(sequence: number, force: boolean): Promise<void> {
  const ackPromise = waitFor('ack')
  send({
    op: 'feed',
    sessionId,
    sequence,
    mimeType: 'audio/webm',
    capturedAt: Date.now(),
    audioPath: streamPath,
    force,
  })
  await Promise.race([
    ackPromise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`ack timeout seq=${sequence}`)),
        180_000,
      ),
    ),
  ])
}

async function main(): Promise<void> {
  console.log(`Replaying ${streamPath}`)
  const readyPromise = ready ? Promise.resolve() : waitFor('ready')
  await Promise.race([
    readyPromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('sidecar ready timeout')), 120_000),
    ),
  ])
  send({ op: 'register', sessionId })

  // Walk the stream in buffered mode, then force-flush the tail a few times.
  let seq = 0
  const maxPasses = 60
  for (let i = 0; i < maxPasses; i++) {
    await feed(seq++, i > 50)
  }
  await feed(seq++, true)

  send({ op: 'unregister', sessionId })
  child.stdin.end()
  await new Promise((r) => setTimeout(r, 500))
  child.kill('SIGTERM')

  const joined = finals.join(' ')
  const blankCount = finals.filter((t) =>
    /BLANK_AUDIO|MUSIC PLAYING/i.test(t),
  ).length
  const tsCount = finals.filter((t) =>
    /\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(t),
  ).length

  console.log('\n==== SUMMARY ====')
  console.log(`segments: ${finals.length}`)
  console.log(`blank/music junk segments: ${blankCount}`)
  console.log(`timestamp-polluted segments: ${tsCount}`)
  console.log(`chars: ${joined.length}`)
  console.log(`lastAck: ${lastAck}`)
  console.log('\n==== FULL TEXT ====')
  console.log(joined)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
