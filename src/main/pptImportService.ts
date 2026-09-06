import { app, dialog, type BrowserWindow } from 'electron'
import path from 'node:path'
import { z } from 'zod'
import { resaveLegacyPpt } from './pptResave'
import type { LegacyPptImportResult } from '../shared/ipcTypes'

const requestSchema = z.object({ operation: z.enum(['select', 'cancel']) }).strict()
const active = new Map<number, AbortController>()
export async function operateLegacyPpt(window: BrowserWindow, request: unknown): Promise<LegacyPptImportResult | null> {
  const input = requestSchema.parse(request)
  if (input.operation === 'cancel') { active.get(window.id)?.abort(); return null }
  if (active.has(window.id)) throw new Error('当前正在转换 PPT，请先取消')
  const controller = new AbortController()
  active.set(window.id, controller)
  const abort = () => controller.abort()
  window.once('closed', abort)
  try {
    const selected = await dialog.showOpenDialog(window, { title: '选择旧版 PPT（通过本机 PowerPoint 转换）', filters: [{ name: 'PowerPoint 97–2003', extensions: ['ppt'] }], properties: ['openFile'] })
    if (selected.canceled || !selected.filePaths[0] || controller.signal.aborted) return null
    const source = selected.filePaths[0]
    return { name: path.basename(source, path.extname(source)) + '.pptx', bytes: await resaveLegacyPpt(source, path.join(app.getPath('temp'), 'ittoedu-ppt-import'), { signal: controller.signal }) }
  } finally { active.delete(window.id); window.removeListener('closed', abort) }
}
