import { app } from 'electron'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
const run = promisify(execFile)
/** Fixed packaged helper; caller is the explicit composer paste handler. No path/command parameters. */
export async function readClipboardFileList(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const helper = app.isPackaged ? path.join(process.resourcesPath, 'clipboard-file-list', 'clipboard-file-list.exe')
    : path.join(app.getAppPath(), 'resources', 'clipboard-file-list', 'clipboard-file-list.exe')
  try {
    const { stdout } = await run(helper, [], { windowsHide: true, timeout: 3000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' })
    const files: unknown = JSON.parse(stdout)
    if (!Array.isArray(files) || files.length > 200 || files.some(value => typeof value !== 'string' || !path.isAbsolute(value) || value.length > 32767)) throw new Error('invalid-list')
    return files
  } catch { throw new Error('系统文件粘贴读取失败，请重试；云端或虚拟文件请先下载到本机或使用“添加附件”') }
}
