import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DocumentHostService } from '../DocumentHostService'
import { htmlImportDesktopRequestSchema } from '../../../shared/workbench/htmlImportDesktop'
import type { HtmlImportDesktopResult } from '../../../shared/workbench/htmlImportDesktop'
import { HtmlImportService } from './HtmlImportService'
import { resolveHtmlImportTarget } from './resolveHtmlImportTarget'

/** Main owns the human run and frozen document target; the S13 Gateway remains the only writer. */
export class HtmlImportDesktopService {
  constructor(private readonly options: {
    documents: DocumentHostService
    chooseSource(): Promise<string | null>
  }) {}

  async import(raw: unknown): Promise<HtmlImportDesktopResult | null> {
    const input = htmlImportDesktopRequestSchema.parse(raw)
    const host = this.options.documents
    const session = host.registry.get(input.documentId)
    const frozen = await session.drain()
    if (frozen.epoch !== input.epoch || frozen.revision !== input.revision)
      throw new Error('HTML 导入目标已改变，请重新选择导入位置')
    if (frozen.model.kind !== 'course-v9') throw new Error('HTML 页面只能导入 Course V9 文档')
    resolveHtmlImportTarget(frozen.model.project, input.locationId, input.anchorBlockId)
    const sourcePath = input.source.kind === 'choose' ? await this.options.chooseSource() : input.source.path
    if (sourcePath === null) return null
    const afterPicker = await session.drain()
    if (afterPicker.epoch !== frozen.epoch || afterPicker.revision !== frozen.revision)
      throw new Error('HTML 导入目标在选择文件期间已改变；未建立候选')
    if (!path.isAbsolute(sourcePath) || path.extname(sourcePath).toLowerCase() !== '.html')
      throw new Error('请选择本地 .html 文件')
    const source = await fs.realpath(sourcePath)
    if (!(await fs.stat(source)).isFile()) throw new Error('HTML 来源不是文件')

    const operationId = `html-import:${randomUUID()}`
    const runId = `human-html-import:${randomUUID()}`
    const gateway = host.tools
    await gateway.beginRun({ runId, actor: 'human', documents: [{ documentId: input.documentId, writable: [{ kind: 'document' }] }] })
    try {
      const current = await session.drain()
      if (current.epoch !== frozen.epoch || current.revision !== frozen.revision)
        throw new Error('HTML 导入目标已改变；未建立候选')
      const targetHandle = await gateway.issueTarget(runId, input.documentId, { kind: 'document' })
      // Issuing a handle drains the session; that await can observe a newer revision.
      const afterHandle = await session.drain()
      if (afterHandle.epoch !== frozen.epoch || afterHandle.revision !== frozen.revision)
        throw new Error('HTML 导入目标在签发句柄期间已改变；未建立候选')
      const service = new HtmlImportService({ session, gateway })
      const ticket = await service.prepare({ operationId, runId, targetHandle, sourcePath: source, locationId: input.locationId, anchorBlockId: input.anchorBlockId })
      await service.admit(ticket)
      const receipt = await service.commit(ticket)
      return { operationId, runId, receipt }
    } finally {
      await gateway.stop(runId)
    }
  }
}
