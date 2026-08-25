import path from 'node:path'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { dialog, ipcMain } from 'electron'
import { z } from 'zod'
import {
  IPC_CHANNELS,
  type SaveBinaryFileInput,
} from '../shared/ipcTypes'
import type { AppState } from './appState'
import { normalizeDesktopError, type DesktopErrorPayload } from './errors'
import {
  openProjectFile,
  openRecentProjectFile,
  saveProjectFile,
  selectAudioFile,
  selectAudioFiles,
  selectComponentFile,
  selectComponentFiles,
  selectImageFile,
  selectImageFiles,
  selectVideoFile,
  selectVideoFiles,
  writeHtmlFile,
  peekProjectArchiveFile,
  writeBinaryExportFile,
  writeWebPackageFile,
} from './fileDialogs'
import { exportPdfFromHtml } from './pdfExport'
import {
  clearRecoveryProject,
  listRecentProjects,
  MAX_RECOVERY_PROJECT_BYTES,
  readRecoveryProject,
  writeRecoveryProject,
} from './projectPersistence'
import { assertTrustedIpcSender } from './security'
import { diagnosticLog, exportDiagnosticReport } from './diagnosticLog'
import { componentCatalogManager } from './componentCatalogManager'
import {
  mainPreviewNetworkPolicy,
  type PreviewNetworkDocumentOwner,
} from './previewNetworkPolicy'

interface IpcSuccess<T> {
  ok: true
  value: T
}

interface IpcFailure {
  ok: false
  error: DesktopErrorPayload
}

type IpcEnvelope<T> = IpcSuccess<T> | IpcFailure

export interface IpcContext {
  getMainWindow(): BrowserWindow | null
  getRendererEntryUrl(): string | null
  appState: AppState
}

const bytesSchema = z.custom<Uint8Array>(
  (value) => value instanceof Uint8Array,
  'bytes 必须是 Uint8Array',
)

const saveProjectSchema = z
  .object({
    path: z.string().min(1).max(32_767).optional(),
    suggestedName: z.string().trim().min(1).max(160),
    bytes: bytesSchema,
  })
  .strict()

const projectPathSchema = z
  .string()
  .min(1)
  .max(32_767)
  .refine((value) => path.isAbsolute(value), '工程路径必须是绝对路径')
  .refine(
    (value) => path.extname(value).toLocaleLowerCase('en-US') === '.h5lesson',
    '工程路径扩展名无效',
  )

const openRecentProjectSchema = z
  .object({
    path: projectPathSchema,
  })
  .strict()

const recoveryProjectSchema = z
  .object({
    projectName: z.string().trim().min(1).max(160),
    projectPath: projectPathSchema.optional(),
    bytes: bytesSchema.refine(
      (bytes) =>
        bytes.byteLength > 0 && bytes.byteLength <= MAX_RECOVERY_PROJECT_BYTES,
      '恢复工程包大小无效',
    ),
  })
  .strict()

const htmlSchema = z
  .object({
    suggestedName: z.string().trim().min(1).max(160),
    html: z.string().min(1).max(256 * 1024 * 1024),
  })
  .strict()

const binaryExportSchema = z.object({
  suggestedName: z.string().trim().min(1).max(160),
  extension: z.enum(['pptx', 'json', 'docx']),
  bytes: bytesSchema.refine((bytes) => bytes.byteLength <= 512 * 1024 * 1024, '导出文件过大'),
}).strict()

const webPackageSchema = z
  .object({
    suggestedName: z.string().trim().min(1).max(160),
    bytes: bytesSchema.refine(
      (bytes) => bytes.byteLength > 0 && bytes.byteLength <= 512 * 1024 * 1024,
      '网页包大小无效',
    ),
  })
  .strict()

const previewNetworkLeaseIdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/)
const previewNetworkPolicySchema = z.object({
  leaseId: previewNetworkLeaseIdSchema,
  connectOrigins: z.array(z.string().min(1).max(300)).max(1_000),
  remoteAssetUrls: z.array(z.string().min(1).max(2_000)).max(10_000),
  documentToken: z.string().uuid(),
}).strict()
const previewNetworkReleaseSchema = z.object({
  leaseId: previewNetworkLeaseIdSchema,
  documentToken: z.string().uuid(),
}).strict()

const dirtySchema = z.boolean()

const diagnosticSchema = z.object({
  source: z.enum(['renderer', 'preview', 'component']),
  message: z.string().min(1).max(8_000),
  stack: z.string().max(24_000).optional(),
}).strict()

const componentCatalogSourceTrustSchema = z.object({
  sourceId: z.string().min(1).max(200),
  trust: z.enum(['trusted', 'prompt']),
}).strict()

const componentCatalogPackageSchema = z.object({
  sourceId: z.string().min(1).max(200),
  packageId: z.string().min(1).max(200),
  version: z.string().min(1).max(100),
}).strict()

function requireNoArguments(args: unknown[]): void {
  if (args.length !== 0) {
    throw new z.ZodError([
      {
        code: 'custom',
        path: [],
        message: '该操作不接受参数',
        input: args,
      },
    ])
  }
}

function requireSingleArgument(args: unknown[]): unknown {
  if (args.length !== 1) {
    throw new z.ZodError([
      {
        code: 'custom',
        path: [],
        message: '该操作需要一个参数',
        input: args,
      },
    ])
  }
  return args[0]
}

function requireWindow(context: IpcContext): BrowserWindow {
  const window = context.getMainWindow()
  if (window === null || window.isDestroyed()) {
    throw new Error('主窗口已经关闭。')
  }
  return window
}

function previewNetworkDocumentOwner(
  event: IpcMainInvokeEvent,
  documentToken: string,
): PreviewNetworkDocumentOwner {
  const frame = event.senderFrame
  if (frame === null || frame.detached) {
    throw new Error('Preview network policy source document is unavailable')
  }
  return {
    processId: frame.processId,
    frameToken: frame.frameToken,
    documentToken,
  }
}

function registerSafeHandler<T>(
  channel: string,
  context: IpcContext,
  fallback: DesktopErrorPayload,
  operation: (
    event: IpcMainInvokeEvent,
    args: unknown[],
  ) => Promise<T> | T,
): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(
    channel,
    async (event, ...args: unknown[]): Promise<IpcEnvelope<T>> => {
      try {
        assertTrustedIpcSender(
          event,
          context.getMainWindow(),
          context.getRendererEntryUrl(),
        )
        return { ok: true, value: await operation(event, args) }
      } catch (error) {
        return { ok: false, error: normalizeDesktopError(error, fallback) }
      }
    },
  )
}

export function registerIpcHandlers(context: IpcContext): void {
  registerSafeHandler(
    IPC_CHANNELS.openProject,
    context,
    {
      code: 'PROJECT_OPEN_FAILED',
      title: '工程打开失败',
      message: '无法打开所选课件工程。',
      suggestion: '请确认文件没有损坏并重试。',
    },
    async (_event, args) => {
      requireNoArguments(args)
      return openProjectFile(requireWindow(context))
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.listRecentProjects,
    context,
    {
      code: 'RECENT_PROJECTS_READ_FAILED',
      title: '最近工程读取失败',
      message: '无法读取最近使用的工程。',
      suggestion: '仍可使用“打开工程”选择本地工程文件。',
    },
    async (_event, args) => {
      requireNoArguments(args)
      return listRecentProjects()
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.openRecentProject,
    context,
    {
      code: 'RECENT_PROJECT_OPEN_FAILED',
      title: '最近工程打开失败',
      message: '无法打开所选最近工程。',
      suggestion: '请使用“打开工程”重新选择该文件。',
    },
    async (_event, args) => {
      const input = openRecentProjectSchema.parse(requireSingleArgument(args))
      return openRecentProjectFile(input.path)
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.saveProject,
    context,
    {
      code: 'PROJECT_SAVE_FAILED',
      title: '工程保存失败',
      message: '无法保存当前课件工程。',
      suggestion: '请改存到有足够空间且可写的位置。',
    },
    async (_event, args) => {
      const input = saveProjectSchema.parse(
        requireSingleArgument(args),
      ) as SaveBinaryFileInput
      return saveProjectFile(requireWindow(context), input)
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.writeRecoveryProject,
    context,
    {
      code: 'RECOVERY_WRITE_FAILED',
      title: '自动恢复保存失败',
      message: '无法写入本地恢复数据。',
      suggestion: '请立即手动保存工程。',
    },
    async (_event, args) => {
      const input = recoveryProjectSchema.parse(requireSingleArgument(args))
      await writeRecoveryProject(input)
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.readRecoveryProject,
    context,
    {
      code: 'RECOVERY_READ_FAILED',
      title: '自动恢复读取失败',
      message: '无法读取本地恢复数据。',
      suggestion: '请打开最近一次手动保存的工程。',
    },
    async (_event, args) => {
      requireNoArguments(args)
      return readRecoveryProject()
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.peekProjectArchive,
    context,
    {
      code: 'PROJECT_PEEK_FAILED',
      title: '工程预检失败',
      message: '无法读取官方工程文件以判断恢复副本。',
      suggestion: '请打开最近一次手动保存的工程。',
    },
    async (_event, args) => {
      const input = openRecentProjectSchema.parse(requireSingleArgument(args))
      return peekProjectArchiveFile(input.path)
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.clearRecoveryProject,
    context,
    {
      code: 'RECOVERY_CLEAR_FAILED',
      title: '恢复数据清理失败',
      message: '无法清理本地恢复数据。',
      suggestion: '请重新启动编辑器后再试。',
    },
    async (_event, args) => {
      requireNoArguments(args)
      await clearRecoveryProject()
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.selectImage,
    context,
    {
      code: 'IMAGE_SELECT_FAILED',
      title: '图片导入失败',
      message: '无法读取所选图片。',
      suggestion: '请确认图片格式正确并重试。',
    },
    async (_event, args) => {
      requireNoArguments(args)
      return selectImageFile(requireWindow(context))
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.selectImages,
    context,
    {
      code: 'IMAGE_BATCH_SELECT_FAILED',
      title: '图片批量导入失败',
      message: '无法读取所选图片。',
      suggestion: '请确认图片格式正确并重试。',
    },
    async (_event, args) => {
      requireNoArguments(args)
      return selectImageFiles(requireWindow(context))
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.selectAudio,
    context,
    {
      code: 'AUDIO_SELECT_FAILED',
      title: '声音导入失败',
      message: '无法读取所选声音。',
      suggestion: '请确认声音格式正确并重试。',
    },
    async (_event, args) => {
      requireNoArguments(args)
      return selectAudioFile(requireWindow(context))
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.selectAudios,
    context,
    {
      code: 'AUDIO_BATCH_SELECT_FAILED',
      title: '声音批量导入失败',
      message: '无法读取所选声音。',
      suggestion: '请确认声音格式正确并重试。',
    },
    async (_event, args) => {
      requireNoArguments(args)
      return selectAudioFiles(requireWindow(context))
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.selectVideo,
    context,
    {
      code: 'VIDEO_SELECT_FAILED',
      title: '视频导入失败',
      message: '无法读取所选视频。',
      suggestion: '请确认视频格式正确并重试。',
    },
    async (_event, args) => {
      requireNoArguments(args)
      return selectVideoFile(requireWindow(context))
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.selectVideos,
    context,
    {
      code: 'VIDEO_BATCH_SELECT_FAILED',
      title: '视频批量导入失败',
      message: '无法读取所选视频。',
      suggestion: '请确认视频格式正确并重试。',
    },
    async (_event, args) => {
      requireNoArguments(args)
      return selectVideoFiles(requireWindow(context))
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.selectComponent,
    context,
    {
      code: 'COMPONENT_SELECT_FAILED',
      title: '组件导入失败',
      message: '无法读取所选组件包。',
      suggestion: '请确认 .h5component 文件有效并重试。',
    },
    async (_event, args) => {
      requireNoArguments(args)
      return selectComponentFile(requireWindow(context))
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.selectComponents,
    context,
    {
      code: 'COMPONENT_BATCH_SELECT_FAILED',
      title: '组件批量导入失败',
      message: '无法读取所选组件包。',
      suggestion: '请确认 .h5component 文件有效并重试。',
    },
    async (_event, args) => {
      requireNoArguments(args)
      return selectComponentFiles(requireWindow(context))
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.loadComponentCatalog,
    context,
    {
      code: 'COMPONENT_CATALOG_LOAD_FAILED',
      title: '组件目录读取失败',
      message: '无法扫描已配置的组件目录。',
      suggestion: '请检查 catalog.json 和目录权限后重试。',
    },
    async (_event, args) => {
      requireNoArguments(args)
      return componentCatalogManager.load()
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.selectComponentCatalogSource,
    context,
    {
      code: 'COMPONENT_CATALOG_SELECT_FAILED',
      title: '组件目录导入失败',
      message: '无法使用所选组件目录。',
      suggestion: '请确认目录根部包含有效的 catalog.json。',
    },
    async (_event, args) => {
      requireNoArguments(args)
      return componentCatalogManager.select(requireWindow(context))
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.setComponentCatalogSourceTrust,
    context,
    {
      code: 'COMPONENT_CATALOG_TRUST_FAILED',
      title: '组件目录信任设置失败',
      message: '无法保存组件目录的信任级别。',
      suggestion: '请重新选择组件目录后再试。',
    },
    async (_event, args) => {
      const input = componentCatalogSourceTrustSchema.parse(requireSingleArgument(args))
      return componentCatalogManager.setTrust(input.sourceId, input.trust)
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.readComponentCatalogPackage,
    context,
    {
      code: 'COMPONENT_CATALOG_PACKAGE_READ_FAILED',
      title: '组件包读取失败',
      message: '目录中的组件包无法读取或哈希已改变。',
      suggestion: '请刷新目录，并确认包文件与 catalog.json 一致。',
    },
    async (_event, args) => {
      const input = componentCatalogPackageSchema.parse(requireSingleArgument(args))
      return componentCatalogManager.readPackage(
        input.sourceId,
        input.packageId,
        input.version,
      )
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.exportHtml,
    context,
    {
      code: 'HTML_EXPORT_FAILED',
      title: 'HTML 导出失败',
      message: '无法写出课件 HTML。',
      suggestion: '请改存到有足够空间且可写的位置。',
    },
    async (_event, args) => {
      const input = htmlSchema.parse(requireSingleArgument(args))
      return writeHtmlFile(requireWindow(context), input.suggestedName, input.html)
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.exportBinary,
    context,
    {
      code: 'BINARY_EXPORT_FAILED',
      title: '文件导出失败',
      message: '无法写出演示文稿。',
      suggestion: '请改存到有足够空间且可写的位置。',
    },
    async (_event, args) => {
      const input = binaryExportSchema.parse(requireSingleArgument(args))
      return writeBinaryExportFile(
        requireWindow(context),
        input.suggestedName,
        input.extension,
        input.bytes,
      )
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.exportWebPackage,
    context,
    {
      code: 'WEB_PACKAGE_EXPORT_FAILED',
      title: '网页包导出失败',
      message: '无法写出网页课件包。',
      suggestion: '请改存到有足够空间且可写的位置。',
    },
    async (_event, args) => {
      const input = webPackageSchema.parse(requireSingleArgument(args))
      return writeWebPackageFile(
        requireWindow(context),
        input.suggestedName,
        input.bytes,
      )
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.exportPdf,
    context,
    {
      code: 'PDF_EXPORT_FAILED',
      title: 'PDF 导出失败',
      message: '无法生成 PDF 文档。',
      suggestion: '请减少大图片数量，或改存到其他位置后重试。',
    },
    async (_event, args) => {
      const input = htmlSchema.parse(requireSingleArgument(args))
      return exportPdfFromHtml(requireWindow(context), input.suggestedName, input.html)
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.setPreviewNetworkPolicy,
    context,
    {
      code: 'PREVIEW_NETWORK_POLICY_FAILED',
      title: '预览网络配置失败',
      message: '无法应用当前课件的网络声明。',
      suggestion: '请检查工程网络声明并重新打开预览。',
    },
    (event, args) => {
      const input = previewNetworkPolicySchema.parse(requireSingleArgument(args))
      mainPreviewNetworkPolicy.replacePreviewLease(
        input,
        previewNetworkDocumentOwner(event, input.documentToken),
      )
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.releasePreviewNetworkPolicy,
    context,
    {
      code: 'PREVIEW_NETWORK_RELEASE_FAILED',
      title: '预览网络清理失败',
      message: '无法撤销已关闭预览的网络声明。',
      suggestion: '请关闭当前工程或重启编辑器。',
    },
    (event, args) => {
      const input = previewNetworkReleaseSchema.parse(requireSingleArgument(args))
      mainPreviewNetworkPolicy.releasePreviewLease(
        input.leaseId,
        previewNetworkDocumentOwner(event, input.documentToken),
      )
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.confirmDiscard,
    context,
    {
      code: 'CONFIRMATION_FAILED',
      title: '确认操作失败',
      message: '无法显示未保存修改提示。',
      suggestion: '请先手动保存工程，然后重试。',
    },
    async (_event, args) => {
      requireNoArguments(args)
      const result = await dialog.showMessageBox(requireWindow(context), {
        type: 'warning',
        title: '放弃未保存的修改？',
        message: '当前课件有尚未保存的修改。',
        detail: '继续后这些修改将丢失。此操作无法撤销。',
        buttons: ['放弃修改', '取消'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      return result.response === 0 ? ('discard' as const) : ('cancel' as const)
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.dirtyState,
    context,
    {
      code: 'DIRTY_STATE_FAILED',
      title: '状态更新失败',
      message: '无法更新未保存状态。',
      suggestion: '请立即保存工程，以免修改丢失。',
    },
    (_event, args) => {
      const dirty = dirtySchema.parse(requireSingleArgument(args))
      context.appState.setDirty(dirty)
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.reportDiagnostic,
    context,
    {
      code: 'DIAGNOSTIC_REPORT_FAILED',
      title: '错误记录失败',
      message: '无法写入本地诊断日志。',
      suggestion: '请保存工程并重新启动编辑器。',
    },
    async (_event, args) => {
      const input = diagnosticSchema.parse(requireSingleArgument(args))
      await diagnosticLog.append(input)
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.exportDiagnostics,
    context,
    {
      code: 'DIAGNOSTIC_EXPORT_FAILED',
      title: '诊断报告导出失败',
      message: '无法导出本地诊断报告。',
      suggestion: '请换一个可写目录后重试。',
    },
    async (_event, args) => {
      requireNoArguments(args)
      return exportDiagnosticReport(requireWindow(context))
    },
  )
}

export function unregisterIpcHandlers(): void {
  for (const channel of Object.values(IPC_CHANNELS)) {
    if (channel !== IPC_CHANNELS.requestSave) ipcMain.removeHandler(channel)
  }
}
