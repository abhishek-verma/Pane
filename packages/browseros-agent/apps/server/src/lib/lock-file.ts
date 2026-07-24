import fs from 'node:fs'
import path from 'node:path'
import { getInstallBrowserosDir } from './browseros-dir'

export class LockFile {
  private lockFilePath: string
  private fd: number | null = null

  constructor(filename = 'server-pid.lock') {
    this.lockFilePath = path.join(getInstallBrowserosDir(), filename)
  }

  public acquire(): boolean {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.lockFilePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      // Try to acquire the lock by opening with wx (write, fail if exists)
      // This is a naive lock. But we actually just want a PID lock, so let's try
      // writing our PID.
      // A more robust PID lock:
      if (fs.existsSync(this.lockFilePath)) {
        const pidStr = fs.readFileSync(this.lockFilePath, 'utf-8')
        const pid = parseInt(pidStr, 10)
        if (!Number.isNaN(pid)) {
          try {
            // Check if process is still running
            process.kill(pid, 0)
            return false // Process is running
          } catch (_e) {
            // Process is not running, we can remove the stale lock
            fs.unlinkSync(this.lockFilePath)
          }
        }
      }

      this.fd = fs.openSync(this.lockFilePath, 'wx')
      fs.writeSync(this.fd, String(process.pid))
      return true
    } catch (_err) {
      return false
    }
  }

  public release(): void {
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd)
        if (fs.existsSync(this.lockFilePath)) {
          fs.unlinkSync(this.lockFilePath)
        }
      } catch (_err) {
        // Ignore
      }
      this.fd = null
    }
  }
}

export const serverLock = new LockFile()
