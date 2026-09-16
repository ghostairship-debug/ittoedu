import { promises as fs } from 'node:fs'
import { setTimeout as pause } from 'node:timers/promises'

const WINDOWS_RENAME_RETRY_DELAYS_MS = [10, 25, 50, 100, 200] as const

/**
 * Publishes a path that its caller has already written and validated. Windows
 * can briefly reject a rename while a reader still holds a handle. This helper
 * never creates, removes, truncates, or rewrites either path.
 */
export async function renamePreparedPath(temporary: string, destination: string,
  beforeAttempt?: () => Promise<boolean>): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    if (await beforeAttempt?.() === false) return false
    try { await fs.rename(temporary, destination); return true }
    catch (error) {
      const delay = WINDOWS_RENAME_RETRY_DELAYS_MS[attempt]
      if (process.platform !== 'win32' || delay === undefined
        || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      await pause(delay)
    }
  }
}
