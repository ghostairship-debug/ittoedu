import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAPI } from '../shared/ipcTypes'

// Sandboxed preloads cannot require local CommonJS modules at runtime. Keep this
// whitelist self-contained; the shared declaration remains the source of API types.
const IPC_CHANNELS = {
  lessonAuthoring: 'lesson-authoring:operate',
  lessonDocumentAi: 'lesson-document-ai:operate',
  flowDocumentRecovery: 'flow-document-recovery:operate',
  lessonMaterial: 'lesson-material:operate',
  lessonDocument: 'lesson-document:operate',
  lesson: 'lesson:operate',
  materials: 'materials:operate',
  localAgent: 'local-agent:operate',
  captureAuthoringObservation: 'local-agent:capture-observation',
  dynamicAdmission: 'dynamic-admission:operate',
  legacyPpt: 'ppt:resave-import',
  openProject: 'project:open',
  listRecentProjects: 'project:list-recent',
  openRecentProject: 'project:open-recent',
  confirmProjectOpen: 'project:confirm-open',
  saveProject: 'project:save',
  writeRecoveryProject: 'project:write-recovery',
  readRecoveryProject: 'project:read-recovery',
  clearRecoveryProject: 'project:clear-recovery',
  selectImage: 'asset:select-image',
  selectImages: 'asset:select-images',
  selectAudio: 'asset:select-audio',
  selectAudios: 'asset:select-audios',
  selectVideo: 'asset:select-video',
  selectVideos: 'asset:select-videos',
  selectComponent: 'component:select-package',
  selectComponents: 'component:select-packages',
  loadComponentCatalog: 'component-catalog:load',
  selectComponentCatalogSource: 'component-catalog:select-source',
  setComponentCatalogSourceTrust: 'component-catalog:set-source-trust',
  readComponentCatalogPackage: 'component-catalog:read-package',
  peekProjectArchive: 'project:peek-archive',
  exportHtml: 'export:write-html',
  exportWebPackage: 'export:write-web-package',
  exportBinary: 'export:write-binary',
  exportPdf: 'export:write-pdf',
  previewNetworkDocumentToken: 'preview-network:document-token',
  setPreviewNetworkPolicy: 'preview-network:set',
  releasePreviewNetworkPolicy: 'preview-network:release',
  confirmDiscard: 'app:confirm-discard',
  dirtyState: 'app:dirty-state',
  requestSave: 'app:request-save',
  requestSaveAndClose: 'app:request-save-and-close',
  requestPreserveAndClose: 'app:request-preserve-and-close',
  preserveAndCloseResult: 'app:preserve-and-close-result',
  saveAndCloseResult: 'app:save-and-close-result',
  reportDiagnostic: 'diagnostics:report',
  exportDiagnostics: 'diagnostics:export',
} as const

interface DesktopErrorPayload {
  code: string
  title: string
  message: string
  suggestion: string
}

interface IpcSuccess<T> {
  ok: true
  value: T
}

interface IpcFailure {
  ok: false
  error: DesktopErrorPayload
}

type IpcEnvelope<T> = IpcSuccess<T> | IpcFailure

let previewNetworkDocumentToken: string | null = null
ipcRenderer.on(IPC_CHANNELS.previewNetworkDocumentToken, (_event, value: unknown) => {
  previewNetworkDocumentToken = typeof value === 'string' && value.length > 0
    ? value
    : null
})

function requirePreviewNetworkDocumentToken(): string {
  if (previewNetworkDocumentToken === null) {
    throw new Error('预览网络文档尚未就绪。请关闭预览后重试。')
  }
  return previewNetworkDocumentToken
}

function isDesktopErrorPayload(value: unknown): value is DesktopErrorPayload {
  if (typeof value !== 'object' || value === null) return false
  const payload = value as Record<string, unknown>
  return (
    typeof payload.code === 'string' &&
    typeof payload.title === 'string' &&
    typeof payload.message === 'string' &&
    typeof payload.suggestion === 'string'
  )
}

function isIpcEnvelope<T>(value: unknown): value is IpcEnvelope<T> {
  if (typeof value !== 'object' || value === null) return false
  const envelope = value as Record<string, unknown>
  if (envelope.ok === true) return 'value' in envelope
  return envelope.ok === false && isDesktopErrorPayload(envelope.error)
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  let result: unknown
  try {
    result = await ipcRenderer.invoke(channel, ...args)
  } catch (error) {
    console.error('桌面 IPC 调用失败', error)
    throw new Error('桌面功能暂时不可用。请重新启动编辑器后重试。')
  }

  if (!isIpcEnvelope<T>(result)) {
    console.error('桌面 IPC 返回了无效响应', result)
    throw new Error('桌面功能返回了无效结果。请重新启动编辑器后重试。')
  }
  if (result.ok) return result.value

  const { code, title, message, suggestion } = result.error
  const error = new Error(`${title}：${message}\n${suggestion}`)
  error.name = `DesktopAPIError:${code}`
  throw error
}

const desktopAPI = Object.freeze<DesktopAPI>({
  lessonDocumentAi: input => invoke(IPC_CHANNELS.lessonDocumentAi, input),
  lessonAuthoring: input => invoke(IPC_CHANNELS.lessonAuthoring, input),
  flowDocumentRecovery: {
    read: target => invoke(IPC_CHANNELS.flowDocumentRecovery, { operation: 'read', target }),
    write: record => invoke(IPC_CHANNELS.flowDocumentRecovery, { operation: 'write', record }),
    clear: target => invoke(IPC_CHANNELS.flowDocumentRecovery, { operation: 'clear', target }),
  },
  lessonMaterials: {
    selectSource: input => invoke(IPC_CHANNELS.lessonMaterial, { operation: 'select', ...input }),
    importMaterial: (target, input) => invoke(IPC_CHANNELS.lessonMaterial, { operation: 'import', target, input }),
    list: target => invoke(IPC_CHANNELS.lessonMaterial, { operation: 'list', target }),
    read: (target, input) => invoke(IPC_CHANNELS.lessonMaterial, { operation: 'read', target, input }),
  },
  lessonFiles: {
    readAiRecords: ref => invoke(IPC_CHANNELS.lessonDocument, { operation: 'read-ai-records', ref }),
    clearAiRecords: (ref, ids) => invoke(IPC_CHANNELS.lessonDocument, { operation: 'clear-ai-records', ref, ids }),
    readResource: (ref, relativePath) => invoke(IPC_CHANNELS.lessonDocument, { operation: 'read-resource', ref, relativePath }),
    invalidateAiEdits: ref => invoke(IPC_CHANNELS.lessonDocument, { operation: 'invalidate', ref }),
    openDocument: ref => invoke(IPC_CHANNELS.lessonDocument, { operation: 'open', ref }),
    saveDocument: request => invoke(IPC_CHANNELS.lessonDocument, { operation: 'save', request }),
    prepareAiEdit: (ref, ranges, epoch) => invoke(IPC_CHANNELS.lessonDocument, { operation: 'prepare', ref, ranges, epoch }),
    applyAiEdit: request => invoke(IPC_CHANNELS.lessonDocument, { operation: 'apply', request }),
    revertAiEdit: (record, currentVersion) => invoke(IPC_CHANNELS.lessonDocument, { operation: 'revert', record, currentVersion }),
    readRecovery: ref => invoke(IPC_CHANNELS.lessonDocument, { operation: 'recovery', ref }),
    preserveDraft: (ref, source, expectedVersion, attachments) => invoke(IPC_CHANNELS.lessonDocument, { operation: 'preserve', ref, source, expectedVersion, attachments }),
  },
  lesson: (input) => invoke(IPC_CHANNELS.lesson, input),
  legacyPpt: (input) => invoke(IPC_CHANNELS.legacyPpt, input),
  localAgent: (input) => invoke(IPC_CHANNELS.localAgent, input),
  captureAuthoringObservation: (input) => invoke(IPC_CHANNELS.captureAuthoringObservation, input),
  dynamicAdmission: (input) => invoke(IPC_CHANNELS.dynamicAdmission, input),
  materials: (input) => invoke(IPC_CHANNELS.materials, input),
  openProject: () => invoke(IPC_CHANNELS.openProject),
  listRecentProjects: () => invoke(IPC_CHANNELS.listRecentProjects),
  openRecentProject: (input) => invoke(IPC_CHANNELS.openRecentProject, input),
  confirmProjectOpen: (input) => invoke(IPC_CHANNELS.confirmProjectOpen, input),
  saveProject: (input) => invoke(IPC_CHANNELS.saveProject, input),
  writeRecoveryProject: (input) => invoke(IPC_CHANNELS.writeRecoveryProject, input),
  readRecoveryProject: () => invoke(IPC_CHANNELS.readRecoveryProject),
  clearRecoveryProject: () => invoke(IPC_CHANNELS.clearRecoveryProject),
  peekProjectArchive: (input) => invoke(IPC_CHANNELS.peekProjectArchive, input),
  selectImage: () => invoke(IPC_CHANNELS.selectImage),
  selectImages: () => invoke(IPC_CHANNELS.selectImages),
  selectAudio: () => invoke(IPC_CHANNELS.selectAudio),
  selectAudios: () => invoke(IPC_CHANNELS.selectAudios),
  selectVideo: () => invoke(IPC_CHANNELS.selectVideo),
  selectVideos: () => invoke(IPC_CHANNELS.selectVideos),
  selectComponentPackage: () => invoke(IPC_CHANNELS.selectComponent),
  selectComponentPackages: () => invoke(IPC_CHANNELS.selectComponents),
  loadComponentCatalog: () => invoke(IPC_CHANNELS.loadComponentCatalog),
  selectComponentCatalogSource: () => invoke(
    IPC_CHANNELS.selectComponentCatalogSource,
  ),
  setComponentCatalogSourceTrust: (input) => invoke(
    IPC_CHANNELS.setComponentCatalogSourceTrust,
    input,
  ),
  readComponentCatalogPackage: (input) => invoke(
    IPC_CHANNELS.readComponentCatalogPackage,
    input,
  ),
  exportHtml: (input) => invoke(IPC_CHANNELS.exportHtml, input),
  exportWebPackage: (input) => invoke(IPC_CHANNELS.exportWebPackage, input),
  exportBinary: (input) => invoke(IPC_CHANNELS.exportBinary, input),
  exportPdf: (input) => invoke(IPC_CHANNELS.exportPdf, input),
  setPreviewNetworkPolicy: (input) => invoke(IPC_CHANNELS.setPreviewNetworkPolicy, {
    ...input,
    documentToken: requirePreviewNetworkDocumentToken(),
  }),
  releasePreviewNetworkPolicy: (input) => invoke(
    IPC_CHANNELS.releasePreviewNetworkPolicy,
    {
      ...input,
      documentToken: requirePreviewNetworkDocumentToken(),
    },
  ),
  confirmDiscardChanges: () => invoke(IPC_CHANNELS.confirmDiscard),
  setDirtyState: (dirty) => invoke(IPC_CHANNELS.dirtyState, dirty),
  onRequestSave: (handler) => {
    if (typeof handler !== 'function') {
      throw new TypeError('保存请求处理器必须是函数。')
    }

    const listener = (): void => {
      try {
        handler()
      } catch (error) {
        console.error('执行保存请求失败', error)
      }
    }
    ipcRenderer.on(IPC_CHANNELS.requestSave, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.requestSave, listener)
    }
  },
  onRequestPreserveAndClose: handler => {
    if (typeof handler !== 'function') throw new TypeError('关闭前恢复稿处理器必须是函数。')
    const listener = (_event: Electron.IpcRendererEvent, requestId: unknown) => {
      if (typeof requestId !== 'string') return
      void Promise.resolve().then(handler).then(saved => ipcRenderer.send(IPC_CHANNELS.preserveAndCloseResult, requestId, saved === true), () => ipcRenderer.send(IPC_CHANNELS.preserveAndCloseResult, requestId, false))
    }
    ipcRenderer.on(IPC_CHANNELS.requestPreserveAndClose, listener)
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.requestPreserveAndClose, listener) }
  },
  onRequestSaveAndClose: (handler) => {
    if (typeof handler !== 'function') {
      throw new TypeError('关闭前保存处理器必须是函数。')
    }

    const listener = (_event: Electron.IpcRendererEvent, requestId: unknown): void => {
      if (typeof requestId !== 'string') return
      void Promise.resolve()
        .then(handler)
        .then((saved) => {
          ipcRenderer.send(IPC_CHANNELS.saveAndCloseResult, requestId, saved === true)
        })
        .catch((error) => {
          console.error('执行关闭前保存失败', error)
          ipcRenderer.send(IPC_CHANNELS.saveAndCloseResult, requestId, false)
        })
    }
    ipcRenderer.on(IPC_CHANNELS.requestSaveAndClose, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.requestSaveAndClose, listener)
    }
  },
  reportDiagnostic: (input) => invoke(IPC_CHANNELS.reportDiagnostic, input),
  exportDiagnostics: () => invoke(IPC_CHANNELS.exportDiagnostics),
})

contextBridge.exposeInMainWorld('desktopAPI', desktopAPI)
if (process.env.COURSEWARE_E2E_BACKGROUND === '1') {
  contextBridge.exposeInMainWorld('__COURSEWARE_E2E_BACKGROUND__', true)
}
