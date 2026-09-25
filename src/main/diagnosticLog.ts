import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, dialog, type BrowserWindow } from 'electron'
import { zipSync, strToU8 } from 'fflate'
import { privateDiagnostic, privateDiagnosticLog } from './diagnosticPrivacy'
import {
  APP_EXECUTABLE_NAME,
  APP_NAME,
} from '../shared/constants'

const MAX_LOG_BYTES = 2 * 1024 * 1024

export type DiagnosticSource = 'main' | 'renderer' | 'preview' | 'component'

export interface DiagnosticEntry {
  source: DiagnosticSource
  message: string
  stack?: string
  details?: Record<string, unknown>
  timestamp?: string
}

function errorEntry(source: DiagnosticSource, error: unknown): DiagnosticEntry {
  if (error instanceof Error) {
    return { source, message: error.message || error.name, stack: error.stack }
  }
  return { source, message: String(error) }
}

export class DiagnosticLog {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly directory: string | (() => string)) {}

  private resolveDirectory(): string {
    return typeof this.directory === 'function' ? this.directory() : this.directory
  }

  private logPath(): string {
    return path.join(this.resolveDirectory(), 'editor-diagnostics.jsonl')
  }

  private previousLogPath(): string {
    return path.join(this.resolveDirectory(), 'editor-diagnostics.previous.jsonl')
  }

  append(entry: DiagnosticEntry): Promise<void> {
    const normalized = privateDiagnostic(entry)
    this.queue = this.queue
      .catch(() => undefined)
      .then(async () => {
        const directory = this.resolveDirectory()
        await fs.mkdir(directory, { recursive: true })
        const current = this.logPath()
        const size = await fs.stat(current).then((stat) => stat.size).catch(() => 0)
        if (size >= MAX_LOG_BYTES) {
          await fs.rm(this.previousLogPath(), { force: true })
          await fs.rename(current, this.previousLogPath()).catch(() => undefined)
        }
        await fs.appendFile(current, `${JSON.stringify(normalized)}\n`, 'utf8')
      })
    return this.queue
  }

  async report(): Promise<string> {
    await this.queue.catch(() => undefined)
    const read = async (filePath: string): Promise<string> =>
      fs.readFile(filePath, 'utf8').catch(() => '')
    const [previous, current] = await Promise.all([
      read(this.previousLogPath()),
      read(this.logPath()),
    ])
    const header = [
      `${APP_NAME}诊断报告`,
      `生成时间：${new Date().toISOString()}`,
      `应用版本：${app?.isReady?.() ? app.getVersion() : (process.env.npm_package_version ?? 'unknown')}`,
      `平台：${process.platform} ${process.arch}`,
      `系统：${os.type()} ${os.release()}`,
      `Electron：${process.versions.electron ?? 'unknown'}`,
      `Chrome：${process.versions.chrome ?? 'unknown'}`,
      `Node：${process.versions.node}`,
      '',
      '默认报告仅含版本、错误类别、错误代码、位置编号与错误指纹；错误正文、路径、请求和任意附加内容已省略。',
      '未自动附加用户文档、对话、图片或登录凭据。',
      '',
    ].join('\n')
    return `${header}\n${privateDiagnosticLog(previous)}\n${privateDiagnosticLog(current)}\n`
  }

  installProcessHandlers(): () => void {
    const onUncaught = (error: Error): void => {
      void this.append(errorEntry('main', error))
    }
    const onRejection = (reason: unknown): void => {
      void this.append(errorEntry('main', reason))
    }
    process.on('uncaughtExceptionMonitor', onUncaught)
    process.on('unhandledRejection', onRejection)
    return () => {
      process.off('uncaughtExceptionMonitor', onUncaught)
      process.off('unhandledRejection', onRejection)
    }
  }
}

export const diagnosticLog = new DiagnosticLog(() =>
  path.join(app.getPath('userData'), 'diagnostics'),
)

export async function exportDiagnosticReport(
  window: BrowserWindow,
): Promise<{ path: string } | null> {
  const consent = await dialog.showMessageBox(window, {
    type: 'info', title: '导出本地诊断',
    message: '报告包含应用与系统版本、脱敏错误信息。默认不包含文档正文、对话或图片。',
    detail: '导出只会保存到你选择的位置，不会自动发送给任何人。若主动附加文档，所选文件的完整内容会进入压缩包，请在分享前自行检查。',
    buttons: ['继续导出', '取消'], defaultId: 0, cancelId: 1,
    checkboxLabel: '主动附加我接下来选择的文档（包含正文与素材）', checkboxChecked: false,
  })
  if (consent.response !== 0) return null
  let attachments: string[] = []
  if (consent.checkboxChecked) {
    const selected = await dialog.showOpenDialog(window, { title: '主动选择附加到诊断的文档', properties: ['openFile', 'multiSelections'], filters: [{ name: '课件与 Markdown 文档', extensions: ['h5lesson', 'md'] }] })
    if (selected.canceled || !selected.filePaths.length) return null
    attachments = selected.filePaths
    if (attachments.some(file => !['.h5lesson', '.md'].includes(path.extname(file).toLowerCase()))) throw new Error('诊断附件仅支持主动选择的课件与 Markdown 文档。')
  }
  const extension = attachments.length ? 'zip' : 'txt'
  const result = await dialog.showSaveDialog(window, {
    title: '导出诊断报告',
    defaultPath: `${APP_EXECUTABLE_NAME}-diagnostics-${new Date()
      .toISOString()
      .slice(0, 10)}.${extension}`,
    filters: [{ name: attachments.length ? '诊断报告与主动附加的文档' : '文本诊断报告', extensions: [extension] }],
  })
  if (result.canceled || !result.filePath) return null
  const report = await diagnosticLog.report()
  if (attachments.length) {
    const files: Record<string, Uint8Array> = { 'diagnostics.txt': strToU8(report), 'attachments-notice.txt': strToU8('以下文档由用户主动选择附加，包含原始正文和素材。它们不是默认诊断日志，也未自动上传。') }
    for (const [index, filename] of attachments.entries()) files[`documents/${index + 1}-${path.basename(filename)}`] = await fs.readFile(filename)
    await fs.writeFile(result.filePath, zipSync(files))
  } else await fs.writeFile(result.filePath, report, 'utf8')
  return { path: result.filePath }
}
