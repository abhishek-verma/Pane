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

      if (fs.existsSync(this.lockFilePath)) {
        const pidStr = fs.readFileSync(this.lockFilePath, 'utf-8')
        const pid = parseInt(pidStr, 10)
        if (!Number.isNaN(pid) && pid !== process.pid) {
          try {
            process.kill(pid, 0) // check if alive
            // Process is alive — this is a stale instance (e.g. after a Sparkle OTA
            // update where the old server kept running). Terminate it gracefully so
            // the new version can bind to the same port.
            try {
              process.kill(pid, 'SIGTERM')
            } catch {
              process.kill(pid, 'SIGKILL')
            }
            // Wait up to 2 s for it to exit before taking over
            const deadline = Date.now() + 2000
            while (Date.now() < deadline) {
              try {
                process.kill(pid, 0)
                // still alive — spin
                const end = Date.now() + 50
                while (Date.now() < end) {
                  /* busy-wait 50 ms */
                }
              } catch {
                break // gone
              }
            }
          } catch {
            // Process not running — stale lock file, remove it
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
