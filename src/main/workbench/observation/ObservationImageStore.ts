import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ObservationImageResource } from '../../../shared/workbench/toolPorts'

const MAX_IMAGE_BYTES = 64 * 1024 * 1024
interface RunImages { directory: Promise<string>; resources: Set<string> }

/** Task-scoped temporary images, not a lifetime screenshot quota. Pixel buffers do not
 * accumulate in Main; original model messages remain owned by RunStore. */
export class ObservationImageStore {
  private readonly runs = new Map<string, RunImages>()
  constructor(private readonly temporaryRoot = os.tmpdir()) {}

  async put(runId: string, bytes: Uint8Array, width: number, height: number): Promise<ObservationImageResource> {
    if (!runId || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
      || bytes.byteLength < 8 || bytes.byteLength > MAX_IMAGE_BYTES
      || !Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      throw new Error('观察图像不是有效 PNG 或单张超过 64 MiB，请降低单张截图分辨率后重试')
    let run = this.runs.get(runId)
    if (!run) {
      run = { directory: fs.mkdtemp(path.join(this.temporaryRoot, 'guoling-observations-')), resources: new Set() }
      this.runs.set(runId, run)
    }
    const resourceId = randomUUID(), frozen = Uint8Array.from(bytes)
    try {
      const directory = await run.directory
      if (this.runs.get(runId) !== run) throw new Error('观察已取消')
      await fs.writeFile(path.join(directory, resourceId), frozen, { flag: 'wx' })
      if (this.runs.get(runId) !== run) {
        await fs.rm(path.join(directory, resourceId), { force: true })
        throw new Error('观察已取消')
      }
      run.resources.add(resourceId)
      return { resourceId, mimeType: 'image/png', width, height, byteLength: frozen.byteLength }
    } catch (error) {
      if (this.runs.get(runId) === run && !run.resources.size) await this.clearRun(runId)
      throw error
    }
  }

  async read(runId: string, resourceId: string): Promise<{ mimeType: string; bytes: Uint8Array }> {
    const run = this.runs.get(runId)
    if (!run?.resources.has(resourceId)) throw new Error('观察图像不存在或不属于当前任务')
    const bytes = await fs.readFile(path.join(await run.directory, resourceId))
    if (this.runs.get(runId) !== run) throw new Error('观察已取消')
    return { mimeType: 'image/png', bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) }
  }

  async clearRun(runId: string): Promise<void> {
    const run = this.runs.get(runId)
    this.runs.delete(runId)
    if (!run) return
    const directory = await run.directory.catch(() => null)
    // Cache cleanup must not turn an acknowledged document result into a failed task.
    if (directory) await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }).catch(() => undefined)
  }
}
