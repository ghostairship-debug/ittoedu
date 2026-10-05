import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DocumentHostService } from '../DocumentHostService'
import { htmlImportDesktopRequestSchema, type HtmlImportDesktopResult } from '../../../shared/workbench/htmlImportDesktop'
import { containerChildIds, owningContainer, type ComponentContainer } from '../../../shared/contracts/component-platform'
import type { ComponentProjectSnapshot } from '../../../core/projectFiles/componentPlatform'
import { decodeComponentHtmlSource } from '../projectFiles/componentPlatformFileInput'
import { readHtmlClosure } from './readHtmlClosure'

/** A manual import captures its original document, then uses the same L19 service/writer as project.apply. */
export class HtmlImportDesktopService {
  constructor(private readonly options: { documents: Pick<DocumentHostService, 'registry' | 'tools'>; chooseSource(): Promise<string | null> }) {}

  async import(raw: unknown): Promise<HtmlImportDesktopResult | null> {
    const input = htmlImportDesktopRequestSchema.parse(raw), host = this.options.documents
    const session = host.registry.get(input.documentId), frozen = await session.drain()
    if (frozen.epoch !== input.epoch) throw new Error('HTML 导入工程会话已变化，请重新选择导入位置')
    if (frozen.model.kind !== 'course-v10') throw new Error('HTML 页面只能导入 Course Project V10；原文件未修改')
    const surface = frozen.model.project.surfaces.find(surface => surface.id === input.surfaceId)
    if (!surface || !['slide', 'flow', 'spatial'].includes(surface.kind)) throw new Error('HTML 导入目标页面已不存在')
    let container: ComponentContainer = { kind: 'surface', surfaceId: surface.id }
    if (input.anchorInstanceId) {
      const owner = owningContainer(frozen.model.project, input.anchorInstanceId)
      let rootOwner = owner
      while (rootOwner?.kind === 'instance') rootOwner = owningContainer(frozen.model.project, rootOwner.instanceId)
      if (!owner || rootOwner?.kind !== 'surface' || rootOwner.surfaceId !== surface.id) throw new Error('HTML 导入锚点不属于所选页面')
      container = owner
    }
    const index = input.anchorInstanceId ? containerChildIds(frozen.model.project, container).indexOf(input.anchorInstanceId) + 1 : surface.childIds.length
    const stateId = input.stateId ?? null
    if (stateId && !surface.presentation?.states.some(state => state.id === stateId)) throw new Error('捕获的展示状态已不存在')
    const sourcePath = input.source.kind === 'choose' ? await this.options.chooseSource() : input.source.path
    if (sourcePath === null) return null
    if (!path.isAbsolute(sourcePath)) throw new Error('HTML 来源需要本地文件的完整路径')
    const source = await fs.realpath(sourcePath)
    if (!(await fs.stat(source)).isFile()) throw new Error('HTML 来源不是文件')
    const runId = `human-html-import:${randomUUID()}`, callId = 'import-html'
    const gateway = host.tools, fileAccess = { permission: 'workspace' as const, workspaceRoot: path.dirname(source) }
    await gateway.beginRun({ runId, actor: 'human', documents: [{ documentId: input.documentId, writable: [{ kind: 'document' }] }], fileAccess })
    try {
      const current = await session.drain()
      if (current.epoch !== frozen.epoch) throw new Error('HTML 导入工程会话已变化；原文件未修改')
      const bytes = new Uint8Array(await fs.readFile(source)), decoded = decodeComponentHtmlSource(bytes)
      const closure = (await readHtmlClosure({ htmlPath: source, rootDir: fileAccess.workspaceRoot, sourceHtml: decoded.text })).siblingFiles
      const result = await gateway.applyComponentContent(runId, callId, frozen as ComponentProjectSnapshot, {
        intent: 'insert', target: { kind: 'container', container, index },
        source: { kind: 'html', html: decoded.text, siblingFiles: closure,
          original: { bytes, filename: path.basename(source), mimeType: 'text/html' } },
        editingContext: { surfaceId: surface.id, stateId }, ...(input.viewport ? { viewport: input.viewport } : {}),
      })
      if (!result.receipt) throw new Error(result.diagnostics.map(item => item.message).join('；') || 'HTML 导入尚未得到提交回执，原件仍保留，请先核对工程')
      return { operationId: result.receipt.operationId, runId, receipt: result.receipt,
        notices: [...decoded.notices, ...result.diagnostics.map(item => `${item.message}${item.reference ? ` (${item.reference})` : ''}`)] }
    } finally { await gateway.stop(runId) }
  }
}
