import { app, dialog, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { type MaterialExtraction } from '../shared/materialExtraction'
import type { LessonMaterialImportProgress } from '../shared/lessonMaterialDesktop'
import { attachmentsDesktopService } from './workbench/attachments/attachmentsDesktopService'
import { LessonMaterials } from './lessonMaterials'
import { LessonWorkspaceService } from './lessonWorkspace'
import { createWorkspaceIdentity } from './workspaceIdentity'
const target = z.object({ lessonId: z.uuid(), rootPath: z.string().min(1).max(32767) }).strict()
const requestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('select'), path: z.string().min(1).max(32767).optional() }).strict(),
  z.object({ operation: z.literal('list'), target }).strict(),
  z.object({ operation: z.literal('import'), target, input: z.object({ title: z.string().min(1).max(300), original: z.instanceof(Uint8Array), extraction: z.custom<MaterialExtraction>() }).strict() }).strict(),
  z.object({ operation: z.literal('cancel-import'), requestId: z.uuid() }).strict(),
  z.object({ operation: z.literal('extract-office'), input: z.object({ requestId: z.uuid(), title: z.string().min(1).max(300).regex(/\.(docx|pptx)$/i), original: z.custom<Uint8Array>(value => value instanceof Uint8Array && value.length > 0) }).strict() }).strict(),
  z.object({ operation: z.literal('import-pdf'), target, input: z.object({ requestId: z.uuid(), title: z.string().min(1).max(300), original: z.custom<Uint8Array>(value => value instanceof Uint8Array), pages: z.object({ from: z.number().int().positive(), to: z.number().int().positive() }).strict().optional(), fromPage: z.number().int().positive().optional() }).strict() }).strict(),
  z.object({ operation: z.literal('read'), target, input: z.object({ id: z.uuid(), extractionVersion: z.string().min(1), fragmentIds: z.array(z.string().min(1)).min(1) }).strict() }).strict(),
])
let materials: LessonMaterials | undefined
const imports = new Map<string, AbortController>()
export async function operateLessonMaterial(window: BrowserWindow, request: unknown, onProgress?: (progress: LessonMaterialImportProgress) => void) {
  const input = requestSchema.parse(request)
  if (!materials) {
    const workspace = new LessonWorkspaceService(app.getPath('userData'))
    materials = new LessonMaterials(async value => { await workspace.read({ schemaVersion: 1, lessonId: value.lessonId, normalizedDirectory: createWorkspaceIdentity(value.lessonId, value.rootPath).normalizedPath }) })
  }
  switch (input.operation) {
    case 'select': {
      let filenames = input.path ? [input.path] : []
      if (!input.path) {
        const result = await dialog.showOpenDialog(window, { title: '选择课例材料（可多选）', properties: ['openFile', 'multiSelections'], filters: [{ name: '教学材料', extensions: ['pdf', 'docx', 'pptx', 'txt', 'md', 'csv', 'png', 'jpg', 'jpeg', 'webp'] }] })
        if (result.canceled) return { sources: [], failures: [] }
        filenames = result.filePaths
      }
      const sources: { title: string; bytes: Uint8Array }[] = [], failures: { title: string; message: string }[] = []
      for (const filename of filenames) {
        const title = path.basename(filename)
        try {
          if (!['.pdf', '.docx', '.pptx', '.txt', '.md', '.csv', '.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(filename).toLowerCase())) throw new Error('请选择 PDF、DOCX、PPTX、文本或 PNG / JPEG / WebP 图片材料')
          const file = await fs.open(filename, 'r')
          try {
            const stat = await file.stat()
            if (!stat.isFile()) throw new Error('材料必须是普通文件')
            const bytes = await file.readFile()
            sources.push({ title, bytes })
          } finally { await file.close() }
        } catch (error) { failures.push({ title, message: error instanceof Error ? error.message : String(error) }) }
      }
      return { sources, failures }
    }
    case 'cancel-import': {
      imports.get(`${window.webContents.id}:${input.requestId}`)?.abort(new Error('材料导入已取消'))
      return
    }
    case 'extract-office': {
      const key = `${window.webContents.id}:${input.input.requestId}`
      if (imports.has(key)) throw new Error('材料导入请求已经存在')
      const frozen = structuredClone(input.input), controller = new AbortController()
      imports.set(key, controller)
      const closed = () => controller.abort(new Error('材料窗口已关闭'))
      window.webContents.once('destroyed', closed)
      try {
        if (window.webContents.isDestroyed()) closed()
        controller.signal.throwIfAborted()
        const service = await attachmentsDesktopService()
        const result = await service.extractOffice({ bytes: frozen.original, filename: frozen.title }, {
          signal: controller.signal,
          onProgress: (page, total) => { if (!controller.signal.aborted) onProgress?.({ requestId: frozen.requestId, page, total }) },
        })
        controller.signal.throwIfAborted()
        return result.material
      } finally {
        imports.delete(key)
        if (!window.webContents.isDestroyed()) window.webContents.removeListener('destroyed', closed)
      }
    }
    case 'import-pdf': {
      const key = `${window.webContents.id}:${input.input.requestId}`
      if (imports.has(key)) throw new Error('材料导入请求已经存在')
      const frozen = structuredClone(input), controller = new AbortController()
      imports.set(key, controller)
      const closed = () => controller.abort(new Error('材料窗口已关闭'))
      window.webContents.once('destroyed', closed)
      try {
        if (window.webContents.isDestroyed()) closed()
        return await materials.importPages(frozen.target, frozen.input, async consume => {
          const service = await attachmentsDesktopService()
          await service.streamPdfPages({ bytes: frozen.input.original, filename: 'document.pdf', pages: frozen.input.pages, fromPage: frozen.input.fromPage, images: 'all' }, {
            signal: controller.signal, onPage: page => consume(page.material),
            onProgress: (page, total) => { if (!controller.signal.aborted) onProgress?.({ requestId: frozen.input.requestId, page, total }) },
          })
        }, controller.signal)
      } finally {
        imports.delete(key)
        if (!window.webContents.isDestroyed()) window.webContents.removeListener('destroyed', closed)
      }
    }
    case 'import': return materials.import(input.target, input.input)
    case 'list': return materials.list(input.target)
    case 'read': return materials.read(input.target, input.input)
  }
}
