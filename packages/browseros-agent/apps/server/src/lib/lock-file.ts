import fs from 'node:fs'
import path from 'node:path'
import { getInstallBrowserosDir } from './browseros-dir'

export class LockFile {
  private lockFilePath: string
  private fd: number | null = null

  constructor(filename = 'server-pid.lock') {
    this.lockFilePath = path.join(getInstallBrowserosDir(), filename)
  }

  public async acquire(): Promise<boolean> {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.lockFilePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      if (fs.existsSync(this.lockFilePath)) {
        const pidStr = fs.readFileSync(this.lockFilePath, 'utf-8')
        const pid = parseInt(pidStr, 10)
        if (!Number.isNaN(pid) && pid !== process.pid) {
          try {
            process.kill(pid, 0) // throws if not running
            // Process is alive — stale instance (e.g. old server still running after
            // a Sparkle OTA update). Terminate it so the new version can bind to the
            // same port. Same-user processes can always signal each other on macOS
            // (no App Sandbox on the server binary).
            try {
              process.kill(pid, 'SIGTERM')
            } catch {
              try {
                process.kill(pid, 'SIGKILL')
              } catch {
                // already gone
              }
            }
            // Wait up to 3 s for it to exit before taking over
            const deadline = Date.now() + 3000
            while (Date.now() < deadline) {
              try {
                process.kill(pid, 0)
                await Bun.sleep(50)
              } catch {
                break // process exited
              }
            }
          } catch {
            // Process not running — stale lock, fall through to remove
          }
          try {
            fs.unlinkSync(this.lockFilePath)
          } catch {
            // ignore
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
