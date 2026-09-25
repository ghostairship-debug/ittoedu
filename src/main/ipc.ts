import { saveDocumentWithDialog } from './workbench/documentSaveDialog'
import { installWorkbenchToolServices, workbenchImageService, workbenchImageSelection } from './workbench/workbenchToolServices'
import { ImageResultsDesktopService } from './workbench/images/ImageResultsDesktopService'
import { closeDocumentWithDialog } from './workbench/documentCloseDialog'
import { trashWorkspaceWithDialog } from './workbench/workspaceTrashDialog'
import { workspaceFilesRequestSchema } from '../shared/workbench/workspaceFiles'
import { operateExternalMcp, closeExternalMcpService } from './workbench/external/externalDesktopService'
import { operateExecutionSettings } from './workbench/providers/executionSettingsService'
import { executionDesktopService } from './workbench/execution/ExecutionDesktopService'
import { installDocumentSaveEvents } from './workbench/execution/DocumentSaveEvents'
import { attachmentsDesktopService } from './workbench/attachments/attachmentsDesktopService'
import { operateWorkspaceFiles, subscribeWorkspaceFilesChanges } from './workbench/workspaceFilesDesktopService'
import path from 'node:path'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { app, dialog, ipcMain } from 'electron'
import { documentHost } from './workbench/documentHost'
import { documentHostRequestSchema } from '../shared/workbench/desktop'
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
  confirmProjectOpen,
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
import { operateMaterials } from './materialService'
import { operateLessonDesktop } from './lessonDesktopService'
import { operateLessonDocument } from './lessonDocumentDesktopService'
import { operateLessonMaterial } from './lessonMaterialDesktopService'
import { operateFlowDocumentRecovery } from './flowDocumentRecovery'
import { operateDynamicAdmission } from './dynamicAdmission'
import { operateLegacyPpt } from './pptImportService'
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
    suggestedDirectory: z.string().min(1).max(32767).refine(value => path.isAbsolute(value)).optional(),
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

const confirmProjectOpenSchema = z
  .object({
    confirmationId: z.uuid(),
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

let stopWorkspaceFileEvents: (() => void) | undefined
let documentSaveEvents: ReturnType<typeof installDocumentSaveEvents> | undefined
let imageResults: ImageResultsDesktopService | undefined
let workspaceFileEventGeneration = 0
export function registerIpcHandlers(context: IpcContext): void {
  installWorkbenchToolServices(context)
  const generation = ++workspaceFileEventGeneration
  const imageResultsReady = executionDesktopService().then(execution => {
    if (generation !== workspaceFileEventGeneration) throw new Error('图片结果服务已关闭')
    imageResults?.dispose()
    const service = new ImageResultsDesktopService({
      directory: path.join(app.getPath('userData'), 'workbench-v2', 'image-actions'),
      images: workbenchImageService(), documents: documentHost(), execution, selection: workbenchImageSelection,
      onError: error => diagnosticLog.append({ source: 'main', message: '图片结果状态未能更新', details: { reason: error instanceof Error ? error.message : String(error) } }),
    })
    execution.setImageRetention({
      prepare: input => service.prepareConversationDeletion(input),
      abort: input => service.abortConversationDeletion(input),
      collect: () => service.requestCollect(),
    })
    service.setEventSink(event => {
      const window = context.getMainWindow()
      if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.imageResultsChanged, event)
    })
    imageResults = service
    return service
  })
  void imageResultsReady.catch(error => diagnosticLog.append({ source: 'main', message: '图片结果服务未能启动', details: { reason: error instanceof Error ? error.message : String(error) } }))
  registerSafeHandler(IPC_CHANNELS.imageResults, context, {
    code: 'IMAGE_RESULT_FAILED', title: '图片操作未完成', message: '图片操作未完成，请查看具体原因。', suggestion: '已生成的图片和已应用的修改已保留。',
  }, async (_event, args) => (await imageResultsReady).operate(requireSingleArgument(args)))
  const saveEventsReady = executionDesktopService().then(service => {
    if (generation !== workspaceFileEventGeneration) return
    documentSaveEvents?.dispose()
    documentSaveEvents = installDocumentSaveEvents({ documents: documentHost(), execution: service,
      onError: error => diagnosticLog.append({ source: 'main', message: '保存状态记录未能更新', details: { reason: error instanceof Error ? error.message : String(error) } }),
    })
  }).catch(error => { diagnosticLog.append({ source: 'main', message: '保存状态订阅未能启动', details: { reason: error instanceof Error ? error.message : String(error) } }) })
  void subscribeWorkspaceFilesChanges(event => {
    const window = context.getMainWindow()
    if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.workspaceFilesChanged, event)
  }).then(stop => { if (generation !== workspaceFileEventGeneration) stop(); else stopWorkspaceFileEvents = stop })
    .catch(error => diagnosticLog.append({ source: 'main', message: '文件变更订阅未能启动', details: { reason: error instanceof Error ? error.message : String(error) } }))
  registerSafeHandler(IPC_CHANNELS.externalMcp, context, {
    code: 'EXTERNAL_MCP_FAILED', title: '外部连接操作未完成', message: '外部连接未完成，请查看具体原因。', suggestion: '文档和已应用的修改已保留。',
  }, async (_event, args) => operateExternalMcp(requireSingleArgument(args)))
  registerSafeHandler(IPC_CHANNELS.attachments, context, {
    code: 'ATTACHMENT_FAILED', title: '附件操作未完成', message: '附件未能处理，请查看具体原因。', suggestion: '已有草稿和原件快照已保留。',
  }, async (event, args) => (await attachmentsDesktopService()).operate(requireSingleArgument(args), requireWindow(context), progress => {
    if (!event.sender.isDestroyed()) event.sender.send(`${IPC_CHANNELS.attachments}:progress`, progress)
  }))
  registerSafeHandler(IPC_CHANNELS.execution, context, {
    code: 'EXECUTION_FAILED', title: '会话操作未完成', message: '当前任务没有完成，请查看具体原因。', suggestion: '文档中已应用的修改已保留。',
  }, async (_event, args) => {
    const service = await executionDesktopService()
    const input = requireSingleArgument(args)
    if (input && typeof input === 'object' && (input as { type?: unknown }).type === 'delete-conversation') await imageResultsReady
    const send = (channel: string, event: unknown) => {
      const window = context.getMainWindow()
      if (window && !window.isDestroyed()) window.webContents.send(channel, event)
    }
    service.setSinks(event => send(IPC_CHANNELS.executionEvent, event), event => send(IPC_CHANNELS.executionEdit, event))
    return service.operate(input)
  })
  registerSafeHandler(IPC_CHANNELS.executionSettings, context, {
    code: 'EXECUTION_SETTINGS_FAILED', title: '模型连接设置未完成',
    message: '连接配置未能保存，请保留当前设置。', suggestion: '请检查连接配置及系统安全存储。',
  }, async (_event, args) => operateExecutionSettings(requireSingleArgument(args)))
  const documents = documentHost()
  documents.setEventSink(event => {
    const window = context.getMainWindow()
    if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.documentEvent, event)
  })
  registerSafeHandler(IPC_CHANNELS.workspaceFiles, context, {
    code: 'WORKSPACE_FILE_OPERATION_FAILED', title: '文件操作未完成',
    message: '文件操作未完成，请查看每项结果。', suggestion: '请保留原件并检查具体原因。',
  }, async (_event, args) => {
    const input = workspaceFilesRequestSchema.parse(requireSingleArgument(args))
    return input.type === 'trash' ? trashWorkspaceWithDialog(requireWindow(context), documents, input) : operateWorkspaceFiles(input)
  })
  registerSafeHandler(IPC_CHANNELS.documents, context, {
    code: 'DOCUMENT_OPERATION_FAILED', title: '文档操作未完成',
    message: '当前更改尚未完成，请保留编辑内容。', suggestion: '请查看具体原因后重试或另存。',
  }, async (_event, args) => {
    await saveEventsReady
    const input = documentHostRequestSchema.parse(requireSingleArgument(args))
    if (input.type === 'close-dialog') return closeDocumentWithDialog(requireWindow(context), documents, input.documentId, input.suggestedDirectory)
    if (input.type !== 'save-dialog') return documents.operate(input)
    return saveDocumentWithDialog(requireWindow(context), documents, input.documentId, input.saveAs, input.suggestedDirectory)
  })
  registerSafeHandler(IPC_CHANNELS.flowDocumentRecovery, context, {
    code: 'FLOW_DOCUMENT_RECOVERY_FAILED', title: '正文恢复稿未保存',
    message: '无法保存或读取 Flow 源文恢复稿。', suggestion: '请保留编辑窗口，检查磁盘后重试。',
  }, async (_event, args) => operateFlowDocumentRecovery(requireSingleArgument(args)))
  registerSafeHandler(IPC_CHANNELS.lessonMaterial, context, {
    code: 'LESSON_MATERIAL_FAILED', title: '材料操作未完成',
    message: '无法读取或保存课例材料。', suggestion: '请检查材料文件和课例目录。',
  }, async (_event, args) => operateLessonMaterial(requireWindow(context), requireSingleArgument(args)))
  registerSafeHandler(IPC_CHANNELS.lessonDocument, context, {
    code: 'LESSON_DOCUMENT_FAILED', title: '文档操作未完成',
    message: '无法完成课例文档操作。', suggestion: '请保留当前稿并检查文件状态。',
  }, async (_event, args) => operateLessonDocument(requireSingleArgument(args)))
  registerSafeHandler(IPC_CHANNELS.lesson, context, {
    code: 'LESSON_OPERATION_FAILED', title: '课例操作未完成',
    message: '无法完成工作空间或课例操作。', suggestion: '请检查目录和文件状态后重试。',
  }, async (_event, args) => operateLessonDesktop(requireWindow(context), requireSingleArgument(args)))
  registerSafeHandler(IPC_CHANNELS.captureAuthoringObservation, context, {
    code: 'OBSERVATION_CAPTURE_FAILED', title: '当前画面尚未同步',
    message: '无法读取当前课件画面。', suggestion: '请等待画面呈现完成后重试。',
  }, async (event, args) => {
    const rect = z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative(),
      width: z.number().finite().positive().max(16384), height: z.number().finite().positive().max(16384) }).strict().parse(requireSingleArgument(args))
    const window = context.getMainWindow()
    if (!window || event.sender.isDestroyed()) throw new Error('观察窗口已关闭')
    const zoom = event.sender.getZoomFactor()
    const bounds = window.getContentBounds()
    const region = { x: Math.floor(rect.x * zoom), y: Math.floor(rect.y * zoom), width: Math.ceil(rect.width * zoom), height: Math.ceil(rect.height * zoom) }
    if (region.x + region.width > bounds.width + 1 || region.y + region.height > bounds.height + 1) throw new Error('观察区域已离开当前窗口，请重新同步')
    const captured = await event.sender.capturePage(region)
    if (captured.isEmpty()) throw new Error('当前画面未就绪')
    return { dataUrl: captured.toDataURL(), capturedAt: Date.now(), ...captured.getSize() }
  })
  registerSafeHandler(IPC_CHANNELS.dynamicAdmission, context, {
    code: 'DYNAMIC_ADMISSION_FAILED', title: '动态候选准入失败',
    message: '候选未通过独立进程检查。', suggestion: '请根据检查结果修正候选后重试。',
  }, async (event, args) => {
    const entry = context.getRendererEntryUrl()
    if (!entry) throw new Error('编辑器页面尚未就绪')
    return operateDynamicAdmission(requireSingleArgument(args), event.sender, entry)
  })
  registerSafeHandler(IPC_CHANNELS.legacyPpt, context, {
    code: 'PPT_RESAVE_FAILED', title: '旧 PPT 转换失败',
    message: '无法转换旧版 PPT。', suggestion: '请使用本机 Microsoft PowerPoint 另存为 PPTX 后导入。',
  }, async (_event, args) => operateLegacyPpt(requireWindow(context), requireSingleArgument(args)))
  registerSafeHandler(IPC_CHANNELS.materials, context, {
    code: 'MATERIAL_OPERATION_FAILED', title: '材料操作失败',
    message: '无法完成本地材料操作。', suggestion: '请检查工程路径或材料文件后重试。',
  }, async (_event, args) => operateMaterials(requireWindow(context), requireSingleArgument(args)))
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
    IPC_CHANNELS.confirmProjectOpen,
    context,
    {
      code: 'PROJECT_OPEN_CONFIRMATION_FAILED',
      title: '工程打开确认失败',
      message: '无法更新最近工程列表。',
      suggestion: '工程仍可继续编辑；如果最近工程未更新，请重新打开一次。',
    },
    async (_event, args) => {
      const input = confirmProjectOpenSchema.parse(requireSingleArgument(args))
      await confirmProjectOpen(input.confirmationId)
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
  workspaceFileEventGeneration++
  stopWorkspaceFileEvents?.(); stopWorkspaceFileEvents = undefined
  const saves = documentSaveEvents; documentSaveEvents = undefined
  if (saves) void saves.flush().finally(() => saves.dispose())
  const images = imageResults; imageResults = undefined
  if (images) { images.setEventSink(undefined); void images.flush().finally(() => images.dispose()) }
  void closeExternalMcpService().catch(() => undefined)
  documentHost().setEventSink(undefined)
  for (const channel of Object.values(IPC_CHANNELS)) {
    if (channel !== IPC_CHANNELS.requestSave) ipcMain.removeHandler(channel)
  }
}
