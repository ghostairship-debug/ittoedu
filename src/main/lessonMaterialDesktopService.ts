import { app, dialog, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { MATERIAL_EXTRACTION_LIMITS, type MaterialExtraction } from '../shared/materialExtraction'
import { LessonMaterials } from './lessonMaterials'
import { LessonWorkspaceService } from './lessonWorkspace'
import { createWorkspaceIdentity } from './workspaceIdentity'
const target = z.object({ lessonId: z.uuid(), rootPath: z.string().min(1).max(32767) }).strict()
const requestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('select'), path: z.string().min(1).max(32767).optional() }).strict(),
  z.object({ operation: z.literal('list'), target }).strict(),
  z.object({ operation: z.literal('import'), target, input: z.object({ title: z.string().min(1).max(300), original: z.instanceof(Uint8Array), extraction: z.custom<MaterialExtraction>() }).strict() }).strict(),
  z.object({ operation: z.literal('read'), target, input: z.object({ id: z.uuid(), extractionVersion: z.string().min(1), fragmentIds: z.array(z.string().min(1)).min(1).max(100000) }).strict() }).strict(),
])
let materials: LessonMaterials | undefined
export async function operateLessonMaterial(window: BrowserWindow, request: unknown) {
  const input = requestSchema.parse(request)
  if (!materials) {
    const workspace = new LessonWorkspaceService(app.getPath('userData'))
    materials = new LessonMaterials(async value => { await workspace.read({ schemaVersion: 1, lessonId: value.lessonId, normalizedDirectory: createWorkspaceIdentity(value.lessonId, value.rootPath).normalizedPath }) })
  }
  switch (input.operation) {
    case 'select': {
      let filename = input.path
      if (!filename) {
        const result = await dialog.showOpenDialog(window, { title: '选择课例材料', properties: ['openFile'], filters: [{ name: '教学材料', extensions: ['pdf', 'docx', 'pptx', 'txt', 'md', 'csv'] }] })
        if (result.canceled || !result.filePaths[0]) return null
        filename = result.filePaths[0]
      }
      if (!['.pdf', '.docx', '.pptx', '.txt', '.md', '.csv'].includes(path.extname(filename).toLowerCase())) throw new Error('请选择 PDF、DOCX、PPTX 或文本材料')
      const file = await fs.open(filename, 'r')
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size > MATERIAL_EXTRACTION_LIMITS.sourceBytes) throw new Error('材料文件不能超过 32 MiB')
        const bytes = await file.readFile()
        if (bytes.length > MATERIAL_EXTRACTION_LIMITS.sourceBytes) throw new Error('材料文件在读取时超过容量上限')
        return { title: path.basename(filename), bytes }
      } finally { await file.close() }
    }
    case 'import': return materials.import(input.target, input.input)
    case 'list': return materials.list(input.target)
    case 'read': return materials.read(input.target, input.input)
  }
}
