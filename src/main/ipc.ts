import { isNativeProjectFilename } from '../shared/nativeProjectFile'
import { installDocumentExportBuildListeners } from './workbench/delivery/DocumentExportBuildListeners'
import { saveDocumentWithDialog } from './workbench/documentSaveDialog'
import { acceptWorkbenchExportBuildReply, acceptWorkbenchExportBuildProgress, disposeWorkbenchExportPort, installWorkbenchToolServices, workbenchImageService, workbenchImageSelection, setWorkbenchHtmlPreview, workbenchHtmlActions, releaseWorkbenchHtmlDocument, buildWorkbenchDocumentExport, buildWorkbenchPptxImport } from './workbench/workbenchToolServices'
import { pptxImportBuildSchema, pptxImportCancelSchema } from '../shared/workbench/pptxImport'
import { FrozenDocumentExportService } from './workbench/delivery/FrozenDocumentExportService'
import { builtComponentDeliverySchema, frozenDeliveryBuildSchema, frozenDeliveryCancelSchema } from '../shared/workbench/frozenDelivery'
import { ImageResultsDesktopService } from './workbench/images/ImageResultsDesktopService'
import { HtmlImportDesktopService } from './workbench/htmlImport/HtmlImportDesktopService'
import { importFlowDocument } from './workbench/office/flowDocumentImport'
import { flowImportRequestSchema } from '../shared/workbench/flowImportDesktop'
import { promises as fs } from 'node:fs'
import { closeDocumentWithDialog } from './workbench/documentCloseDialog'
import { trashWorkspaceWithDialog } from './workbench/workspaceTrashDialog'
import { workspaceFilesRequestSchema } from '../shared/workbench/workspaceFiles'
import { mediaFilesRequestSchema, mediaFileDraftInputSchema, fileArtifactBindingSchema } from '../shared/workbench/mediaFiles'
import { operateMediaFiles } from './workbench/mediaFilesDesktopService'
import { operateExternalMcp, closeExternalMcpService, attachExternalMcpWindow } from './workbench/external/externalDesktopService'
import { operateExecutionSettings } from './workbench/providers/executionSettingsService'
import { operatePixabaySettings } from './workbench/assetSources/pixabayDesktopService'
import { executionDesktopService } from './workbench/execution/ExecutionDesktopService'
import { installDocumentSaveEvents } from './workbench/execution/DocumentSaveEvents'
import { attachmentsDesktopService } from './workbench/attachments/attachmentsDesktopService'
import { attachHtmlPreviewHost, operateWorkspaceFiles, subscribeWorkspaceFilesChanges, authorizeWorkspaceFilesRoot, assertAuthorizedWorkspacePath } from './workbench/workspaceFilesDesktopService'
import { workbenchSkillCatalog } from './workbench/workbenchToolServices'
import { skillCatalogRequestSchema } from '../shared/workbench/skillCatalogDesktop'
import { HtmlPreviewService } from './workbench/htmlPreview/HtmlPreviewService'
import { HtmlSourceEditService } from './workbench/htmlPreview/HtmlSourceEditService'
import { ViewObservationDesktopService } from './workbench/observation/ViewObservationDesktopService'
import { publishedCourseV3Schema } from '../shared/contracts/component-platform/published'
import { setHtmlPreviewProtocolHandler } from './protocols'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { app, dialog, ipcMain, shell } from 'electron'
import { documentHost } from './workbench/documentHost'
import { uiDocumentEvent, uiDocumentResult } from './workbench/uiDocumentSnapshot'
import { componentCompilationInputSchema } from '../shared/workbench/componentCompilation'
import { documentHostRequestSchema } from '../shared/workbench/desktop'
import { spatialViewportCaptureSchema } from '../shared/workbench/spatialViewport'
import { z } from 'zod'
import {
  IPC_CHANNELS,
  COURSE_OBJECT_CLIPBOARD_COMMAND_EVENT,
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

const documentExportBuildReplySchema = z.object({
  requestId: z.string().uuid(),
  identity: z.object({ documentId: z.string().min(1), epoch: z.string().min(1), revision: z.number().int().nonnegative(), projectId: z.string().min(1) }).strict(),
  status: z.enum(['generated', 'drained', 'failed', 'cancelled']),
  files: z.array(z.object({ relativePath: z.string(), mimeType: z.string(), bytes: z.instanceof(Uint8Array) }).strict()).optional(),
  printHtml: z.string().optional(),
  warnings: z.array(z.string()),
  reason: z.string().optional(),
  delivery: builtComponentDeliverySchema.optional(),
}).strict()
const documentExportBuildProgressSchema = z.object({
  requestId: z.uuid(), identity: documentExportBuildReplySchema.shape.identity,
  sequence: z.number().int().positive(), stage: z.enum(['preparing', 'building', 'compiling', 'complete']),
}).strict()

const bytesSchema = z.custom<Uint8Array>(
  (value) => value instanceof Uint8Array,
  'bytes 必须是 Uint8Array',
)

const saveProjectSchema = z
  .object({
    suggestedDirectory: z.string().min(1).max(32767).refine(value => path.isAbsolute(value)).optional(),
    path: z.string().min(1).max(32_767).optional(),
    suggestedName: z.string().trim().min(1),
    bytes: bytesSchema,
  })
  .strict()

const projectPathSchema = z
  .string()
  .min(1)
  .max(32_767)
  .refine((value) => path.isAbsolute(value), '工程路径必须是绝对路径')
  .refine(
    (value) => isNativeProjectFilename(value),
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
    projectName: z.string().trim().min(1),
    projectPath: projectPathSchema.optional(),
    bytes: bytesSchema.refine(
      (bytes) =>
        bytes.byteLength > 0,
      '恢复工程包大小无效',
    ),
  })
  .strict()

const htmlSchema = z
  .object({
    suggestedName: z.string().trim().min(1),
    html: z.string().min(1),
    projectPath: projectPathSchema.optional(),
  })
  .strict()

const binaryExportSchema = z.object({
  suggestedName: z.string().trim().min(1),
  extension: z.enum(['pptx', 'json', 'docx', 'h5component']),
  bytes: bytesSchema,
  projectPath: projectPathSchema.optional(),
}).strict()

const webPackageSchema = z
  .object({
    suggestedName: z.string().trim().min(1),
    projectPath: projectPathSchema.optional(),
    bytes: bytesSchema.refine(
      (bytes) => bytes.byteLength > 0,
      '网页包大小无效',
    ),
  })
  .strict()

const previewNetworkLeaseIdSchema = z.string().min(1).regex(/^[A-Za-z0-9._:-]+$/)
const previewNetworkPolicySchema = z.object({
  leaseId: previewNetworkLeaseIdSchema,
  connectOrigins: z.array(z.string().min(1)),
  remoteAssetUrls: z.array(z.string().min(1)),
  documentToken: z.string().uuid(),
}).strict()
const previewNetworkReleaseSchema = z.object({
  leaseId: previewNetworkLeaseIdSchema,
  documentToken: z.string().uuid(),
}).strict()
const componentBootstrapSchema = previewNetworkReleaseSchema.extend({
  html: z.string(), connectOrigins: z.array(z.string().min(1)).optional(), remoteAssetUrls: z.array(z.string().min(1)).optional(),
  resourceSources: z.array(z.object({ url: z.string().min(1), usage: z.enum(['image', 'media', 'stylesheet', 'font']) }).strict()).optional(),
}).strict()

const dirtySchema = z.boolean()

const diagnosticSchema = z.object({
  source: z.enum(['renderer', 'preview', 'component']),
  message: z.string().min(1).max(8_000),
  stack: z.string().max(24_000).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
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

const componentCatalogHtmlComponentSchema = z.object({
  sourceId: z.string().min(1).max(200),
  entry: z.string().min(1).max(300),
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
let stopExecutionTimelineClients: (() => void) | undefined
let documentSaveEvents: ReturnType<typeof installDocumentSaveEvents> | undefined
let elementCardCleanup: (() => void) | undefined
let imageResults: ImageResultsDesktopService | undefined
let workspaceFileEventGeneration = 0
let stopExportBuildListeners: (() => void) | undefined
let frozenDeliveryBuilds: FrozenDocumentExportService | undefined
const pptxImportJobs = new Map<string, AbortController>()
let htmlPreview: HtmlPreviewService | undefined
let htmlPreviewClosedCleanup: (() => void) | undefined
export function releaseAllHtmlPreviewLeases(): void { htmlPreview?.releaseAll() }
let detachExternalMcpWindow: (() => void) | undefined
let stopMediaBindingEvents: (() => void) | undefined

/** Input capture uses the existing renderer owner, without saving or changing the foreground. */
function requestRendererInput<T>(window: BrowserWindow, requestChannel: string, resultChannel: string,
  input: unknown, decode: (value: unknown) => T): Promise<T> {
  if (window.isDestroyed() || window.webContents.isCrashed() || window.webContents.isLoadingMainFrame())
    return Promise.reject(new Error('文档界面尚未就绪，当前输入未确认'))
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      ipcMain.removeListener(resultChannel, receive)
      window.removeListener('closed', unavailable)
      window.webContents.removeListener('render-process-gone', unavailable)
      window.webContents.removeListener('did-start-navigation', navigating)
    }
    const unavailable = () => { cleanup(); reject(new Error('文档界面已断开，当前输入未确认')) }
    const navigating = (_event: unknown, _url: string, _inPlace: boolean, mainFrame: boolean) => { if (mainFrame) unavailable() }
    const receive = (event: IpcMainEvent, id: unknown, ready: unknown, value: unknown) => {
      if (event.sender !== window.webContents || id !== requestId) return
      cleanup()
      if (ready !== true) { reject(new Error(typeof value === 'string' ? value : '文档输入尚未确认，原输入已保留')); return }
      try { resolve(decode(value)) } catch (error) { reject(error) }
    }
    ipcMain.on(resultChannel, receive)
    window.once('closed', unavailable)
    window.webContents.once('render-process-gone', unavailable)
    window.webContents.on('did-start-navigation', navigating)
    try { window.webContents.send(requestChannel, requestId, input) }
    catch (error) { cleanup(); reject(error) }
  })
}

export function registerIpcHandlers(context: IpcContext): void {
  installWorkbenchToolServices(context)
  stopExecutionTimelineClients?.()
  const timelineRegistrationId = randomUUID()
  const timelineClients = new Map<number, { current(): { id: string; isCurrent(): boolean }; dispose(): void }>()
  const timelineClient = (sender: IpcMainInvokeEvent['sender']) => {
    let client = timelineClients.get(sender.id)
    if (!client) {
      let generation = 0, disposed = false
      const id = () => `${timelineRegistrationId}:${sender.id}:${generation}`
      const invalidate = () => {
        const previous = id(); generation++
        void executionDesktopService().then(service => service.releaseTimelineClient(previous)).catch(() => undefined)
      }
      const navigated = (details: { isMainFrame: boolean; isSameDocument: boolean }) => { if (details.isMainFrame && !details.isSameDocument) invalidate() }
      const dispose = () => {
        if (disposed) return
        disposed = true; invalidate(); timelineClients.delete(sender.id)
        sender.removeListener('destroyed', dispose)
        sender.removeListener('render-process-gone', invalidate)
        sender.removeListener('did-start-navigation', navigated)
      }
      sender.on('destroyed', dispose)
      sender.on('render-process-gone', invalidate)
      sender.on('did-start-navigation', navigated)
      client = { current: () => {
        const expected = generation
        return { id: id(), isCurrent: () => !disposed && !sender.isDestroyed() && expected === generation }
      }, dispose }
      timelineClients.set(sender.id, client)
    }
    return client.current()
  }
  stopExecutionTimelineClients = () => { for (const client of [...timelineClients.values()]) client.dispose() }
  stopExportBuildListeners?.()
  stopExportBuildListeners = installDocumentExportBuildListeners(ipcMain, { progress: (event: IpcMainEvent, raw: unknown) => {
    try {
      assertTrustedIpcSender(event, context.getMainWindow(), context.getRendererEntryUrl())
      acceptWorkbenchExportBuildProgress(documentExportBuildProgressSchema.parse(raw), event.sender.id)
    } catch { /* Foreign or stale progress cannot keep an export alive. */ }
  }, reply: (event: IpcMainEvent, raw: unknown) => {
    try {
      assertTrustedIpcSender(event, context.getMainWindow(), context.getRendererEntryUrl())
      const reply = documentExportBuildReplySchema.parse(raw)
      acceptWorkbenchExportBuildReply(reply, event.sender.id)
    } catch { /* A foreign, malformed, stale or duplicate export reply cannot write a file. */ }
  } })
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
    elementCardCleanup?.()
    // M15: an element's AI card ends with its document.
    elementCardCleanup = documentHost().subscribeClosed(documentId => {
      void service.clearElementConversations(documentId).catch(error => diagnosticLog.append({ source: 'main', message: '元素 AI 卡记录未能清理',
        details: { reason: error instanceof Error ? error.message : String(error) } }))
    })
    documentSaveEvents = installDocumentSaveEvents({ documents: documentHost(), execution: service,
      onError: error => diagnosticLog.append({ source: 'main', message: '保存状态记录未能更新', details: { reason: error instanceof Error ? error.message : String(error) } }),
    })
  }).catch(error => { diagnosticLog.append({ source: 'main', message: '保存状态订阅未能启动', details: { reason: error instanceof Error ? error.message : String(error) } }) })
  void subscribeWorkspaceFilesChanges(event => {
    const window = context.getMainWindow()
    if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.workspaceFilesChanged, event)
  }).then(stop => { if (generation !== workspaceFileEventGeneration) stop(); else stopWorkspaceFileEvents = stop })
    .catch(error => diagnosticLog.append({ source: 'main', message: '文件变更订阅未能启动', details: { reason: error instanceof Error ? error.message : String(error) } }))
  registerSafeHandler(IPC_CHANNELS.launchFiles, context, {
    code: 'LAUNCH_FILE_FAILED', title: '打开文件未完成', message: '启动文件尚未打开。', suggestion: '当前文件和恢复稿保留。',
  }, async (_event, args) => {
    const input = z.discriminatedUnion('type', [z.object({ type: z.literal('list') }).strict(), z.object({ type: z.literal('ack'), id: z.uuid() }).strict()]).parse(requireSingleArgument(args))
    if (input.type === 'ack') context.appState.acknowledgeOpenFile(input.id)
    return context.appState.pendingOpenFiles()
  })
  detachExternalMcpWindow?.()
  detachExternalMcpWindow = attachExternalMcpWindow(context.getMainWindow)
  registerSafeHandler(IPC_CHANNELS.externalMcp, context, {
    code: 'EXTERNAL_MCP_FAILED', title: '外部连接操作未完成', message: '外部连接未完成，请查看具体原因。', suggestion: '文档和已应用的修改已保留。',
  }, async (_event, args) => operateExternalMcp(requireSingleArgument(args)))
  registerSafeHandler(IPC_CHANNELS.attachments, context, {
    code: 'ATTACHMENT_FAILED', title: '附件操作未完成', message: '附件未能处理，请查看具体原因。', suggestion: '已有草稿和原件快照已保留。',
  }, async (event, args) => (await attachmentsDesktopService()).operate(requireSingleArgument(args), requireWindow(context), progress => {
    if (!event.sender.isDestroyed()) event.sender.send(`${IPC_CHANNELS.attachments}:progress`, progress)
  }))
  registerSafeHandler(IPC_CHANNELS.execution, context, {
    // The service maps its own failures to specific reasons; this is left for a service that could not be reached.
    code: 'EXECUTION_FAILED', title: '会话操作未完成', message: '会话服务暂时不可用。', suggestion: '请重试；若仍失败，请重新启动编辑器。当前输入和已应用的修改已保留。',
  }, async (event, args) => {
    const client = timelineClient(event.sender)
    const service = await executionDesktopService()
    const input = requireSingleArgument(args)
    if (input && typeof input === 'object' && (input as { type?: unknown }).type === 'delete-conversation') await imageResultsReady
    const send = (channel: string, event: unknown) => {
      const window = context.getMainWindow()
      if (window && !window.isDestroyed()) window.webContents.send(channel, event)
    }
    service.setSinks(event => send(IPC_CHANNELS.executionEvent, event), event => send(IPC_CHANNELS.executionEdit, event))
    return service.operate(input, client)
  })
  registerSafeHandler(IPC_CHANNELS.executionSettings, context, {
    code: 'EXECUTION_SETTINGS_FAILED', title: '模型连接设置未完成',
    message: '连接配置未能保存，请保留当前设置。', suggestion: '请检查连接配置及系统安全存储。',
  }, async (_event, args) => operateExecutionSettings(requireSingleArgument(args)))
  registerSafeHandler(IPC_CHANNELS.pixabaySettings, context, {
    code: 'PIXABAY_SETTINGS_FAILED', title: 'Pixabay 设置未完成',
    message: 'Pixabay 设置未能保存，原配置已保留。', suggestion: '请检查系统安全存储。',
  }, async (_event, args) => operatePixabaySettings(requireSingleArgument(args)))
  const documents = documentHost()
  frozenDeliveryBuilds?.dispose()
  const frozenBuilds = new FrozenDocumentExportService({
    readRevision: (documentId, revision) => documents.registry.get(documentId).readRevision(revision),
    build: buildWorkbenchDocumentExport,
  })
  frozenDeliveryBuilds = frozenBuilds
  registerSafeHandler(IPC_CHANNELS.frozenDeliveryBuild, context, {
    code: 'EXPORT_BUILD_FAILED', title: '导出未能生成', message: '当前工程与原文件已保留。', suggestion: '请查看具体原因后重试。',
  }, async (event, args) => frozenBuilds.build(frozenDeliveryBuildSchema.parse(requireSingleArgument(args)), {
    id: event.sender.id,
    onDestroyed: stop => {
      event.sender.once('destroyed', stop)
      if (event.sender.isDestroyed()) stop()
      return () => { event.sender.removeListener('destroyed', stop) }
    },
  }))
  registerSafeHandler(IPC_CHANNELS.frozenDeliveryCancel, context, {
    code: 'EXPORT_CANCEL_FAILED', title: '导出停止未完成', message: '当前工程与原文件已保留。', suggestion: '请查看任务状态。',
  }, async (event, args) => frozenBuilds.cancel(frozenDeliveryCancelSchema.parse(requireSingleArgument(args)).requestId, event.sender.id))
  registerSafeHandler(IPC_CHANNELS.pptxImportBuild, context, {
    code: 'PPTX_IMPORT_FAILED', title: 'PPTX 导入未完成', message: '源文件和当前工程已保留。', suggestion: '请查看具体原因后重试。',
  }, async (event, args) => {
    const input = pptxImportBuildSchema.parse(requireSingleArgument(args)), key = `${event.sender.id}:${input.requestId}`
    if (pptxImportJobs.has(key)) throw new Error('PPTX 转换请求编号重复')
    const controller = new AbortController(), destroyed = () => controller.abort(new Error('PPTX 导入窗口已关闭'))
    pptxImportJobs.set(key, controller); event.sender.once('destroyed', destroyed)
    if (event.sender.isDestroyed()) destroyed()
    try {
      controller.signal.throwIfAborted()
      const result = await buildWorkbenchPptxImport(input, controller.signal)
      controller.signal.throwIfAborted(); return result
    }
    finally { event.sender.removeListener('destroyed', destroyed); if (pptxImportJobs.get(key) === controller) pptxImportJobs.delete(key) }
  })
  registerSafeHandler(IPC_CHANNELS.pptxImportCancel, context, {
    code: 'PPTX_CANCEL_FAILED', title: 'PPTX 转换停止未完成', message: '源文件和当前工程已保留。', suggestion: '请查看转换状态。',
  }, async (event, args) => {
    const input = pptxImportCancelSchema.parse(requireSingleArgument(args)), job = pptxImportJobs.get(`${event.sender.id}:${input.requestId}`)
    if (!job) return false
    job.abort(new Error('PPTX 导入已取消')); return true
  })
  documents.setDocumentInputPreparer(documentId => requestRendererInput(requireWindow(context),
    IPC_CHANNELS.requestPrepareDocumentInput, IPC_CHANNELS.prepareDocumentInputResult, documentId, () => undefined))
  documents.setSpatialViewportPreparer(input => requestRendererInput(requireWindow(context),
    IPC_CHANNELS.requestCaptureSpatialViewport, IPC_CHANNELS.captureSpatialViewportResult, input, value => spatialViewportCaptureSchema.parse(value)))
  documents.setMediaCopyPreparer((source, kind) => requestRendererInput(requireWindow(context),
    IPC_CHANNELS.requestCaptureMediaCopy, IPC_CHANNELS.captureMediaCopyResult, { source, kind }, value => z.array(mediaFileDraftInputSchema).parse(value)))
  stopMediaBindingEvents?.()
  stopMediaBindingEvents = documents.artifacts.subscribeBindings(change => {
    const window = context.getMainWindow()
    if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.mediaArtifactBindingChanged, change)
  })
  htmlPreviewClosedCleanup?.()
  htmlPreview?.dispose()
  const preview = new HtmlPreviewService({
    readDocument: documentId => documents.registry.get(documentId).drain(),
    readDocumentIdentity: documentId => documents.registry.get(documentId).drainIdentity(),
    readCapturedHtmlPreviewSources: (documentId, source, root) => documents.readCapturedHtmlPreviewSources(documentId, source, root),
    networkOwner: () => mainPreviewNetworkPolicy.currentDocumentOwner(),
    currentMainFrame: () => {
      const window = context.getMainWindow()
      if (!window || window.isDestroyed() || window.webContents.mainFrame.detached) return null
      const frame = window.webContents.mainFrame
      return { webContentsId: window.webContents.id, processId: frame.processId, frameToken: frame.frameToken }
    },
    agentBundlePath: path.join(app.getAppPath(), 'dist-renderer', 'html-preview-agent.iife.js'),
  })
  preview.setEditPort(new HtmlSourceEditService({
    readDocument: documentId => documents.internalAPI.read(documentId),
    execute: operation => documents.internalAPI.dispatch(operation),
    withFileAccess: work => documents.fileCoordinator.withFileAccess(work),
  }))
  htmlPreview = preview
  registerSafeHandler(IPC_CHANNELS.createComponentBootstrap, context, {
    code: 'COMPONENT_BOOTSTRAP_FAILED', title: '组件内容加载失败',
    message: '未能创建组件内容环境。', suggestion: '请查看具体原因并保留组件源码。',
  }, (event, args) => {
    const { documentToken, ...input } = componentBootstrapSchema.parse(requireSingleArgument(args))
    return preview.createComponentBootstrap(input, previewNetworkDocumentOwner(event, documentToken))
  })
  registerSafeHandler(IPC_CHANNELS.releaseComponentBootstrap, context, {
    code: 'COMPONENT_BOOTSTRAP_RELEASE_FAILED', title: '组件内容清理失败',
    message: '未能清理已关闭的组件内容环境。', suggestion: '请关闭当前工程后重试。',
  }, (event, args) => {
    const input = previewNetworkReleaseSchema.parse(requireSingleArgument(args))
    preview.releaseComponentBootstrap(input.leaseId, previewNetworkDocumentOwner(event, input.documentToken))
  })
  setWorkbenchHtmlPreview(preview)
  setHtmlPreviewProtocolHandler(preview.handleProtocolRequest)
  const stopPreviewClosed = documents.subscribeClosed(documentId => { preview.releaseDocument(documentId); releaseWorkbenchHtmlDocument(documentId) })
  htmlPreviewClosedCleanup = () => { stopPreviewClosed() }
  void attachHtmlPreviewHost(preview).catch(error => diagnosticLog.append({ source: 'main', message: 'HTML 预览服务未能启动', details: { reason: error instanceof Error ? error.message : String(error) } }))
  const htmlImport = new HtmlImportDesktopService({
    documents,
    chooseSource: async () => {
      const result = await dialog.showOpenDialog(requireWindow(context), { properties: ['openFile'], filters: [{ name: 'HTML', extensions: ['html'] }] })
      return result.canceled ? null : result.filePaths[0] ?? null
    },
  })
  registerSafeHandler(IPC_CHANNELS.htmlImport, context, {
    code: 'HTML_IMPORT_FAILED', title: 'HTML 导入未完成',
    message: 'HTML 页面未能导入。', suggestion: '请检查来源文件与当前目标后重试。',
  }, async (_event, args) => htmlImport.import(requireSingleArgument(args)))
  documents.setEventSink(event => {
    if (event.type === 'state') preview.releaseChangedBinding(event.head)
    else if (event.type === 'changed') preview.releaseChangedBinding(event.head ?? event.snapshot)
    const window = context.getMainWindow()
    if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.documentEvent, uiDocumentEvent(event))
  })
  registerSafeHandler(IPC_CHANNELS.workspaceFiles, context, {
    code: 'WORKSPACE_FILE_OPERATION_FAILED', title: '文件操作未完成',
    message: '文件操作未完成，请查看每项结果。', suggestion: '请保留原件并检查具体原因。',
  }, async (_event, args) => {
    const input = workspaceFilesRequestSchema.parse(requireSingleArgument(args))
    return input.type === 'trash' ? trashWorkspaceWithDialog(requireWindow(context), documents, input) : operateWorkspaceFiles(input)
  })
  registerSafeHandler(IPC_CHANNELS.flowImport, context, {
    code: 'FLOW_IMPORT_FAILED', title: '文档导入未完成', message: '正文未能导入，原文件仍保留。', suggestion: '请核对文件格式，并查看诊断报告。',
  }, async (_event, args) => {
    const input = flowImportRequestSchema.parse(requireSingleArgument(args))
    let filename: string
    if (input.sourceEntryId) {
      if (!input.directory) throw new Error('导入来源缺少授权的工作空间')
      const source = await operateWorkspaceFiles({ type: 'resolve', workspaceId: input.directory.workspaceId, entryId: input.sourceEntryId })
      if (source.kind !== 'file') throw new Error('导入来源必须是文件')
      filename = source.resolvedPath
    } else {
      const picked = await dialog.showOpenDialog(requireWindow(context), { title: '导入到可编辑 Flow', properties: ['openFile'], filters: [{ name: 'Word、Markdown 与文本', extensions: ['docx', 'md', 'markdown', 'txt'] }] })
      if (picked.canceled || !picked.filePaths[0]) return null
      filename = picked.filePaths[0]
    }
    return importFlowDocument(filename, new Uint8Array(await fs.readFile(filename)))
  })
  registerSafeHandler(IPC_CHANNELS.skillCatalog, context, {
    code: 'SKILL_CATALOG_FAILED', title: 'Skill目录未能读取', message: 'Skill目录未能读取。', suggestion: '请检查当前工作空间后重试。',
  }, async (_event, args) => {
    const input = skillCatalogRequestSchema.parse(requireSingleArgument(args))
    const root = input.workspaceDirectory ? await assertAuthorizedWorkspacePath(input.workspaceDirectory) : undefined
    return workbenchSkillCatalog(root)
  })
  registerSafeHandler(IPC_CHANNELS.documents, context, {
    code: 'DOCUMENT_OPERATION_FAILED', title: '文档操作未完成',
    message: '当前更改尚未完成，请保留编辑内容。', suggestion: '请查看具体原因后重试或另存。',
  }, async (_event, args) => {
    await saveEventsReady
    const input = documentHostRequestSchema.parse(requireSingleArgument(args))
    if (input.type === 'reveal') {
      const snapshot = await documents.internalAPI.read(input.documentId)
      if (snapshot.binding.kind !== 'file') throw new Error('文档尚未保存，没有所在文件夹')
      shell.showItemInFolder(snapshot.binding.path)
      return
    }
    if (input.type === 'close-dialog') return closeDocumentWithDialog(requireWindow(context), documents, input.documentId, input.suggestedDirectory, input.discardOnly)
    const result = input.type === 'save-dialog'
      ? await saveDocumentWithDialog(requireWindow(context), documents, input.documentId, input.saveAs, input.suggestedDirectory)
      : await documents.operate(input)
    return uiDocumentResult(input, result)
  })
  registerSafeHandler(IPC_CHANNELS.componentCompilation, context, {
    code: 'COMPONENT_COMPILE_FAILED', title: '组件源码未能编译',
    message: '源码和参数已保留。', suggestion: '请查看组件诊断并修复源码。',
  }, async (_event, args) => documents.compilation.compile(componentCompilationInputSchema.parse(requireSingleArgument(args))))
  registerSafeHandler(IPC_CHANNELS.mediaFiles, context, {
    code: 'MEDIA_FILE_OPERATION_FAILED', title: '媒体文件操作未完成',
    message: '当前修改已保留。', suggestion: '请查看具体原因后重试。',
  }, async (_event, args) => operateMediaFiles(mediaFilesRequestSchema.parse(requireSingleArgument(args))))
  registerSafeHandler(IPC_CHANNELS.mediaFileRelease, context, {
    code: 'MEDIA_DRAFT_RELEASE_FAILED', title: '媒体预览未能释放', message: '原文件保持不变。', suggestion: '关闭后可重新打开。',
  }, async (_event, args) => { documents.artifacts.media.release(fileArtifactBindingSchema.parse(requireSingleArgument(args))) })
  registerSafeHandler(IPC_CHANNELS.lessonMaterial, context, {
    code: 'LESSON_MATERIAL_FAILED', title: '材料操作未完成',
    message: '无法读取或保存课例材料。', suggestion: '请检查材料文件和课例目录。',
  }, async (event, args) => operateLessonMaterial(requireWindow(context), requireSingleArgument(args), progress => {
    if (!event.sender.isDestroyed()) event.sender.send(`${IPC_CHANNELS.lessonMaterial}:progress`, progress)
  }))
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
    message: '无法读取当前画面。', suggestion: '请等待画面呈现完成后重试。',
  }, async (event, args) => {
    const input = z.union([
      z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative(),
        width: z.number().finite().positive().max(16384), height: z.number().finite().positive().max(16384) }).strict(),
      z.object({ kind: z.literal('published'), published: publishedCourseV3Schema, surfaceId: z.string().min(1),
        stateId: z.string().min(1).nullable().optional(), instanceId: z.string().min(1).optional(), spatialFrameId: z.string().min(1).optional(), staticExport: z.literal(true).optional() }).strict(),
    ]).parse(requireSingleArgument(args))
    if ('published' in input) {
      const entry = context.getRendererEntryUrl()
      if (!entry || event.sender.isDestroyed()) throw new Error('输出捕获宿主已关闭')
      const controller = new AbortController(), abort = () => controller.abort()
      event.sender.once('destroyed', abort)
      try {
        const result = await new ViewObservationDesktopService({ rendererEntryUrl: entry }).capturePublished({
          published: input.published, locationId: input.surfaceId, stateId: input.stateId,
          instanceId: input.instanceId, spatialFrameId: input.spatialFrameId, signal: controller.signal,
          staticExport: input.staticExport,
        })
        return { dataUrl: `data:image/png;base64,${Buffer.from(result.png).toString('base64')}`,
          capturedAt: Date.now(), width: result.width, height: result.height }
      } finally { event.sender.removeListener('destroyed', abort) }
    }
    const rect = input
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
      message: '无法打开所选 果铃工程。',
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
      message: '无法保存当前 果铃工程。',
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
    IPC_CHANNELS.deleteComponentCatalogHtmlComponent,
    context,
    {
      code: 'COMPONENT_CATALOG_HTML_DELETE_FAILED',
      title: 'HTML 组件删除失败',
      message: '无法从“我的资产库”删除这个 HTML 组件。',
      suggestion: '请刷新组件库后重试。',
    },
    async (_event, args) => {
      const input = componentCatalogHtmlComponentSchema.parse(requireSingleArgument(args))
      return componentCatalogManager.deleteHtmlComponent(input.sourceId, input.entry)
    },
  )

  registerSafeHandler(IPC_CHANNELS.installComponentLibraryEntry, context, {
    code: 'COMPONENT_LIBRARY_INSTALL_FAILED', title: '组件保存失败',
    message: '无法将组件写入“我的资产库”。', suggestion: '请检查组件内容和目录写入权限。',
  }, async (_event, args) => {
    const input = z.object({ bytes: z.instanceof(Uint8Array) }).strict().parse(requireSingleArgument(args))
    return componentCatalogManager.install(input.bytes)
  })
  registerSafeHandler(IPC_CHANNELS.deleteComponentCatalogPackage, context, {
    code: 'COMPONENT_LIBRARY_DELETE_FAILED', title: '组件删除失败',
    message: '无法从“我的资产库”删除这个组件。', suggestion: '请刷新组件库后重试。',
  }, async (_event, args) => {
    const input = componentCatalogPackageSchema.parse(requireSingleArgument(args))
    return componentCatalogManager.deletePackage(input.sourceId, input.packageId, input.version)
  })

  registerSafeHandler(
    IPC_CHANNELS.exportHtml,
    context,
    {
      code: 'HTML_EXPORT_FAILED',
      title: 'HTML 导出失败',
      message: '无法写出 HTML。',
      suggestion: '请改存到有足够空间且可写的位置。',
    },
    async (_event, args) => {
      const input = htmlSchema.parse(requireSingleArgument(args))
      return writeHtmlFile(requireWindow(context), input.suggestedName, input.html, input.projectPath)
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
        input.projectPath,
      )
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.exportWebPackage,
    context,
    {
      code: 'WEB_PACKAGE_EXPORT_FAILED',
      title: '网页包导出失败',
      message: '无法写出网页包。',
      suggestion: '请改存到有足够空间且可写的位置。',
    },
    async (_event, args) => {
      const input = webPackageSchema.parse(requireSingleArgument(args))
      return writeWebPackageFile(
        requireWindow(context),
        input.suggestedName,
        input.bytes,
        input.projectPath,
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
      return exportPdfFromHtml(requireWindow(context), input.suggestedName, input.html, input.projectPath)
    },
  )

  registerSafeHandler(
    IPC_CHANNELS.setPreviewNetworkPolicy,
    context,
    {
      code: 'PREVIEW_NETWORK_POLICY_FAILED',
      title: '预览网络配置失败',
      message: '无法应用当前 果铃工程的网络声明。',
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
    IPC_CHANNELS.editorClipboard,
    context,
    {
      code: 'EDITOR_CLIPBOARD_FAILED',
      title: '编辑命令失败',
      message: '剪贴板操作未完成。',
      suggestion: '请聚焦主编辑窗口后重试。',
    },
    async (event, args) => {
      const command = z.union([
        z.enum(['cut', 'copy', 'paste', 'paste-plain']),
        z.object({ command: z.enum(['cut', 'copy']), requestId: z.string().min(1) }),
      ]).parse(requireSingleArgument(args))
      const window = requireWindow(context)
      if (event.sender !== window.webContents || !window.isFocused() || !event.sender.isFocused()) {
        throw new Error('主编辑窗口未获得焦点。')
      }
      if (typeof command !== 'string') {
        // Copy/cut events emitted by execCommand finish in this same renderer
        // stack. The initiating owner validates its target immediately before
        // execution and always releases its event listener, including no-event.
        await event.sender.executeJavaScript(`(() => {
          const detail = { command: ${JSON.stringify(command.command)}, requestId: ${JSON.stringify(command.requestId)}, handled: false, ok: false, reason: '' };
          window.dispatchEvent(new CustomEvent(${JSON.stringify(COURSE_OBJECT_CLIPBOARD_COMMAND_EVENT)}, { detail }));
          if (!detail.handled) throw new Error('剪贴板命令的发起窗口已失效，请重试');
          if (!detail.ok) throw new Error(detail.reason || '系统剪贴板命令未完成，请重试');
        })()`, true)
        return
      }
      switch (command) {
        case 'cut': event.sender.cut(); break
        case 'copy': event.sender.copy(); break
        case 'paste': event.sender.paste(); break
        case 'paste-plain': event.sender.pasteAndMatchStyle(); break
      }
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
  stopExecutionTimelineClients?.(); stopExecutionTimelineClients = undefined
  workspaceFileEventGeneration++
  frozenDeliveryBuilds?.dispose(); frozenDeliveryBuilds = undefined
  for (const controller of pptxImportJobs.values()) controller.abort(new Error('PPTX 导入服务已关闭'))
  pptxImportJobs.clear()
  stopExportBuildListeners?.(); stopExportBuildListeners = undefined
  disposeWorkbenchExportPort()
  htmlPreviewClosedCleanup?.(); htmlPreviewClosedCleanup = undefined
  htmlPreview?.dispose(); htmlPreview = undefined
  setHtmlPreviewProtocolHandler(null)
  stopWorkspaceFileEvents?.(); stopWorkspaceFileEvents = undefined
  const saves = documentSaveEvents; documentSaveEvents = undefined
  elementCardCleanup?.(); elementCardCleanup = undefined
  if (saves) void saves.flush().finally(() => saves.dispose())
  const images = imageResults; imageResults = undefined
  if (images) { images.setEventSink(undefined); void images.flush().finally(() => images.dispose()) }
  detachExternalMcpWindow?.(); detachExternalMcpWindow = undefined
  void closeExternalMcpService().catch(() => undefined)
  documentHost().setEventSink(undefined)
  documentHost().setDocumentInputPreparer(undefined)
  documentHost().setSpatialViewportPreparer(undefined)
  documentHost().setMediaCopyPreparer(undefined)
  stopMediaBindingEvents?.(); stopMediaBindingEvents = undefined
  for (const channel of Object.values(IPC_CHANNELS)) {
    if (channel !== IPC_CHANNELS.requestSave) ipcMain.removeHandler(channel)
  }
}
