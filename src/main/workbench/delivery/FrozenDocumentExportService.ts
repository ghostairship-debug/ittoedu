import type { DocumentSnapshot } from '../../../shared/workbench/document'
import { builtComponentDeliverySchema, type BuiltComponentDelivery, type FrozenDeliveryBuildInput } from '../../../shared/workbench/frozenDelivery'
import type { ExportBuildReply, ExportBuildRequest } from '../../../shared/workbench/toolPorts'
import { validateExportBuildIdentity } from '../../../shared/workbench/documentDelivery'

interface FrozenExportOwner {
  id: number
  onDestroyed(stop: () => void): () => void
}

/** A GUI build job freezes an existing revision; it never owns drafts or file publication. */
export class FrozenDocumentExportService {
  private readonly active = new Map<string, AbortController>()
  constructor(private readonly ports: {
    readRevision(documentId: string, revision: number): DocumentSnapshot | undefined
    build(request: ExportBuildRequest, signal: AbortSignal): Promise<ExportBuildReply>
  }) {}
  async build(input: FrozenDeliveryBuildInput, owner: FrozenExportOwner): Promise<BuiltComponentDelivery> {
    const key = `${owner.id}:${input.requestId}`
    if (this.active.has(key)) throw new Error('导出请求编号重复')
    // readRevision returns an immutable capture of the requested historical
    // model. Newer accepted edits remain free to proceed during this job.
    const snapshot = this.ports.readRevision(input.identity.documentId, input.identity.revision)
    if (!snapshot || snapshot.documentId !== input.identity.documentId || snapshot.epoch !== input.identity.epoch
      || snapshot.revision !== input.identity.revision || snapshot.model.kind !== 'course-v10'
      || snapshot.model.project.id !== input.identity.projectId || snapshot.model.project.revision !== input.identity.revision)
      throw new Error('导出的冻结版本已无法定位，请在原文档重新执行')
    const controller = new AbortController()
    this.active.set(key, controller)
    const removeDestroyed = owner.onDestroyed(() => controller.abort(new Error('导出窗口已关闭')))
    const request: ExportBuildRequest = { requestId: input.requestId, identity: input.identity, snapshot,
      format: input.format === 'single-html' ? input.singleHtmlMode === 'online-lightweight' ? 'html-online' : 'html-offline' : input.format,
      ...(input.options ? { options: input.options } : {}), includeDelivery: true }
    try {
      controller.signal.throwIfAborted()
      const reply = await this.ports.build(request, controller.signal)
      controller.signal.throwIfAborted()
      validateExportBuildIdentity(request, reply)
      if (reply.status !== 'generated' || !reply.delivery) throw new Error(reply.reason ?? '导出未生成当前冻结版本')
      const result = builtComponentDeliverySchema.parse(reply.delivery)
      if (result.report.projectId !== input.identity.projectId || result.report.target !== input.format)
        throw new Error('导出结果与冻结工程或格式不一致')
      return result
    } finally {
      removeDestroyed()
      if (this.active.get(key) === controller) this.active.delete(key)
    }
  }
  cancel(requestId: string, ownerId: number): boolean {
    const controller = this.active.get(`${ownerId}:${requestId}`)
    if (!controller) return false
    controller.abort(new Error('导出已取消'))
    return true
  }
  dispose(): void {
    for (const controller of this.active.values()) controller.abort(new Error('导出服务已关闭'))
    this.active.clear()
  }
}
