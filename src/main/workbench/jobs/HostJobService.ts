import type { ImageJobSnapshot, ImageJobTimingMark } from '../../../shared/workbench/images'
import type { ComputeJobSnapshot } from '../../../shared/workbench/compute'
import type { ImageGenerationService } from '../images/ImageGenerationService'
import type { ComputeJobService } from '../compute/ComputeJobService'
import type { DelegationJobService, DelegationJobSnapshot, DelegationJobLog } from '../delegation/DelegationJobService'

/** A thin route to the durable owners. This service stores no second job state. */
export type HostJobRef = { runId: string; kind: 'image' | 'compute' | 'delegation'; jobId: string }
export type HostJobSnapshot =
  | { kind: 'image'; jobId: string; status: ImageJobSnapshot['status']; terminal: boolean; snapshot: ImageJobSnapshot }
  | { kind: 'compute'; jobId: string; status: ComputeJobSnapshot['status']; terminal: boolean; snapshot: ComputeJobSnapshot }
  | { kind: 'delegation'; jobId: string; status: DelegationJobSnapshot['status']; terminal: boolean; snapshot: DelegationJobSnapshot }
export type HostJobLog = {
  entries: readonly ({ cursor: number; time: number; stage: ImageJobTimingMark['stage']; level: 'info'; message: string }
    | { cursor: number; time: number; stream: 'stdout' | 'stderr' | 'system'; message: string }
    | DelegationJobLog['entries'][number])[]
  nextCursor: number
}

function page(after = 0, limit = 100): { after: number; limit: number } {
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error('作业日志分页参数无效')
  return { after, limit }
}

export class HostJobService {
  constructor(private readonly owners: { images: ImageGenerationService;
    compute?: ComputeJobService; delegation?: DelegationJobService }) {}

  private image(runId: string, job: ImageJobSnapshot): HostJobSnapshot {
    if (job.runId !== runId) throw new Error('图片任务不属于当前运行')
    return { kind: 'image', jobId: job.jobId, status: job.status,
      terminal: !['preparing', 'running'].includes(job.status), snapshot: job }
  }
  private compute(job: ComputeJobSnapshot): HostJobSnapshot {
    return { kind: 'compute', jobId: job.jobId, status: job.status,
      terminal: !['preparing', 'running'].includes(job.status), snapshot: job }
  }
  private delegation(job: DelegationJobSnapshot): HostJobSnapshot {
    return { kind: 'delegation', jobId: job.jobId, status: job.status, terminal: job.terminal, snapshot: job }
  }
  private computeOwner(): ComputeJobService {
    if (!this.owners.compute) throw new Error('通用计算后端未配置')
    return this.owners.compute
  }
  private delegationOwner(): DelegationJobService {
    if (!this.owners.delegation) throw new Error('Codex 委派作业服务未配置')
    return this.owners.delegation
  }

  async status(ref: HostJobRef): Promise<HostJobSnapshot> {
    if (ref.kind === 'image') return this.image(ref.runId, await this.owners.images.read(ref.jobId))
    if (ref.kind === 'compute') return this.compute(await this.computeOwner().status(ref.runId, ref.jobId))
    return this.delegation(await this.delegationOwner().status(ref.runId, ref.jobId))
  }

  /** Returns the latest owner receipt at completion, stop, or the bounded deadline. */
  async wait(ref: HostJobRef & { milliseconds: number; signal?: AbortSignal }): Promise<HostJobSnapshot> {
    if (ref.kind === 'image') return this.image(ref.runId, await this.owners.images.wait(ref.runId, ref.jobId, ref.milliseconds, ref.signal))
    if (ref.kind === 'compute') return this.compute(await this.computeOwner().wait(ref.runId, ref.jobId, ref.milliseconds, ref.signal))
    return this.delegation(await this.delegationOwner().wait(ref.runId, ref.jobId, ref.milliseconds, ref.signal))
  }

  async logs(ref: HostJobRef & { after?: number; limit?: number }): Promise<HostJobLog> {
    const { after, limit } = page(ref.after, ref.limit)
    if (ref.kind === 'compute') return this.computeOwner().logs(ref.runId, ref.jobId, after, limit)
    if (ref.kind === 'delegation') return this.delegationOwner().logs(ref.runId, ref.jobId, after, limit)
    const job = await this.owners.images.read(ref.jobId)
    if (job.runId !== ref.runId) throw new Error('图片任务不属于当前运行')
    const marks = job.timing ?? []
    return { entries: marks.slice(after, after + limit).map((mark, index) => ({
      cursor: after + index + 1, time: mark.wallTimeMs, stage: mark.stage, level: 'info' as const,
      message: mark.detail ? `${mark.stage}: ${JSON.stringify(mark.detail)}` : mark.stage,
    })), nextCursor: Math.min(marks.length, after + limit) }
  }

  async cancel(ref: HostJobRef): Promise<HostJobSnapshot> {
    // Confirm run ownership before crossing the stop boundary, including image
    // jobs whose owner cancellation method takes only a job id.
    await this.status(ref)
    if (ref.kind === 'image') return this.image(ref.runId, await this.owners.images.stop(ref.jobId))
    if (ref.kind === 'compute') return this.compute(await this.computeOwner().cancel(ref.runId, ref.jobId))
    return this.delegation(await this.delegationOwner().cancel(ref.runId, ref.jobId))
  }
}
