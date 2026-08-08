import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LockFile } from '../../src/lib/lock-file'

describe('LockFile Contention', () => {
  // Pin BROWSEROS_DIR to a per-test temp dir so the suite never touches the
  // real ~/.browseros (or ~/.browseros-dev) and doesn't collide with other
  // lib tests that share the home dir. getBrowserosDir() honors this env.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pane-lock-'))
  const testLockName = 'test-server-pid.lock'
  const lockFilePath = path.join(tempRoot, testLockName)
  let testLock: LockFile
  let previousBrowserosDir: string | undefined

  beforeEach(() => {
    previousBrowserosDir = process.env.BROWSEROS_DIR
    process.env.BROWSEROS_DIR = tempRoot
    testLock = new LockFile(testLockName)
  })

  afterEach(() => {
    // Ensure the lock is released after each test
    testLock.release()
    try {
      if (fs.existsSync(lockFilePath)) {
        fs.unlinkSync(lockFilePath)
      }
    } catch {}
    if (previousBrowserosDir === undefined) {
      delete process.env.BROWSEROS_DIR
    } else {
      process.env.BROWSEROS_DIR = previousBrowserosDir
    }
  })

  afterAll(() => {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    } catch {}
  })

  it('acquires lock successfully when no lock exists', async () => {
    const success = await testLock.acquire()
    expect(success).toBe(true)
    expect(fs.existsSync(lockFilePath)).toBe(true)

    // Verify our PID is in the file
    const pidStr = fs.readFileSync(lockFilePath, 'utf-8')
    expect(parseInt(pidStr, 10)).toBe(process.pid)
  })

  it('fails to acquire lock when lock is held by another process', async () => {
    // Simulate another process holding the lock by writing a dummy PID that exists (our own PID for testing,
    // but in reality we pretend it is another process that is running).
    // Actually, if we write our own PID, the LockFile checks if it's running using process.kill, which returns true.
    // So it will think another process is running.
    const dir = path.dirname(lockFilePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(lockFilePath, String(process.pid))

    const lock = new LockFile(testLockName)
    const success = await lock.acquire()
    expect(success).toBe(false)
  })

  it('steals lock if held by a dead process', async () => {
    // Write a PID of a process that is definitely dead (e.g. 9999999)
    const deadPid = 9999999
    const dir = path.dirname(lockFilePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(lockFilePath, String(deadPid))

    const lock = new LockFile(testLockName)
    const success = await lock.acquire()

    expect(success).toBe(true)
    // The lock file should now have our PID
    const pidStr = fs.readFileSync(lockFilePath, 'utf-8')
    expect(parseInt(pidStr, 10)).toBe(process.pid)
    lock.release()
  })

  it('releases lock correctly', async () => {
    const lock = new LockFile(testLockName)
    expect(await lock.acquire()).toBe(true)
    expect(fs.existsSync(lockFilePath)).toBe(true)

    lock.release()
    expect(fs.existsSync(lockFilePath)).toBe(false)
  })
})
