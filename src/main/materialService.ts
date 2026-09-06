import { app, dialog, shell, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { materialRequestSchema, MAX_MATERIAL_TEXT_LENGTH, type MaterialRecordV1 } from '../shared/materialContract'
import { createWorkspaceIdentity } from './workspaceIdentity'
import { MaterialRepository } from './materialRepository'

let repository: MaterialRepository | undefined

export async function operateMaterials(window: BrowserWindow, request: unknown): Promise<MaterialRecordV1[]> {
  const input = materialRequestSchema.parse(request)
  const workspace = createWorkspaceIdentity(input.projectId, input.projectPath)
  repository ??= new MaterialRepository(app.getPath('userData'))
  switch (input.operation) {
    case 'search': return repository.search(workspace, input.query)
    case 'import-text': return [await repository.import(workspace, input.input)]
    case 'import-file': {
      const selection = await dialog.showOpenDialog(window, {
        title: '导入教学材料', properties: ['openFile'],
        filters: [{ name: '文本材料', extensions: ['txt', 'md', 'csv'] }],
      })
      if (selection.canceled || !selection.filePaths[0]) return []
      const filename = selection.filePaths[0]
      if (!['.txt', '.md', '.csv'].includes(path.extname(filename).toLowerCase())) throw new Error('目前支持 TXT、Markdown 和 CSV 文本材料')
      const handle = await fs.open(filename, 'r')
      let bytes: Buffer
      try {
        const stat = await handle.stat()
        if (!stat.isFile() || stat.size > MAX_MATERIAL_TEXT_LENGTH) throw new Error('材料文件需小于 2 MB')
        bytes = Buffer.alloc(MAX_MATERIAL_TEXT_LENGTH + 1)
        let offset = 0
        while (offset < bytes.length) {
          const result = await handle.read(bytes, offset, bytes.length - offset, offset)
          if (result.bytesRead === 0) break
          offset += result.bytesRead
        }
        if (offset > MAX_MATERIAL_TEXT_LENGTH) throw new Error('材料文件需小于 2 MB')
        bytes = bytes.subarray(0, offset)
      } finally { await handle.close() }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return [await repository.import(workspace, { title: path.basename(filename), text, source: { kind: 'file', locator: filename } })]
    }
    case 'locate': {
      const record = await repository.read(workspace, input.id)
      if (!record) throw new Error('材料已删除或不属于当前工程')
      if (record.source.kind === 'file') {
        await fs.access(record.source.locator)
        shell.showItemInFolder(record.source.locator)
      }
      return [record]
    }
    case 'delete': await repository.delete(workspace, input.id); return []
    case 'clear': await repository.delete(workspace); return []
  }
}
