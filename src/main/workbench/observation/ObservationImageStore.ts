import { randomUUID } from 'node:crypto'
import type { ObservationImageResource } from '../../../shared/workbench/toolPorts'

const MAX_IMAGE_BYTES = 24 * 1024 * 1024
const MAX_RUN_BYTES = 48 * 1024 * 1024
const MAX_RUN_IMAGES = 8

/** Ephemeral Main resources; no document asset, history entry, or disk write. */
export class ObservationImageStore {
  private readonly runs = new Map<string, Map<string, { mimeType: string; bytes: Uint8Array }>>()
  put(runId: string, bytes: Uint8Array, width: number, height: number): ObservationImageResource {
    if (!runId || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
      || bytes.byteLength < 8 || bytes.byteLength > MAX_IMAGE_BYTES
      || !Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      throw new Error('观察图像不是有效范围内的 PNG')
    const resources = this.runs.get(runId) ?? new Map()
    const used = [...resources.values()].reduce((sum, entry) => sum + entry.bytes.byteLength, 0)
    if (resources.size >= MAX_RUN_IMAGES || used + bytes.byteLength > MAX_RUN_BYTES) throw new Error('本次观察图像资源已达到上限')
    const resourceId = randomUUID()
    resources.set(resourceId, { mimeType: 'image/png', bytes: Uint8Array.from(bytes) })
    this.runs.set(runId, resources)
    return { resourceId, mimeType: 'image/png', width, height, byteLength: bytes.byteLength }
  }
  read(runId: string, resourceId: string): { mimeType: string; bytes: Uint8Array } {
    const resource = this.runs.get(runId)?.get(resourceId)
    if (!resource) throw new Error('观察图像不存在或不属于当前任务')
    return { mimeType: resource.mimeType, bytes: Uint8Array.from(resource.bytes) }
  }
  clearRun(runId: string): void { this.runs.delete(runId) }
}
