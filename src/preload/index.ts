import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAPI } from '../shared/ipcTypes'
import type { AttachmentReadProgress } from '../shared/workbench/attachmentsDesktop'

// Sandboxed preloads cannot require local CommonJS modules at runtime. Keep this
// whitelist self-contained; the shared declaration remains the source of API types.
const IPC_CHANNELS = {
  imageResults: 'image-results:operate',
  imageResultsChanged: 'image-results:changed',
  externalMcp: 'external-mcp:operate',
  attachments: 'attachments:operate',
  execution: 'execution:operate',
  executionEvent: 'execution:event',
  executionEdit: 'execution:edit',
  executionSettings: 'execution-settings:operate',
  workspaceFiles: 'workspace-files:operate',
  workspaceFilesChanged: 'workspace-files:changed',
  documents: 'documents:operate',
  documentEvent: 'documents:event',
  flowDocumentRecovery: 'flow-document-recovery:operate',
  lessonMaterial: 'lesson-material:operate',
  lessonDocument: 'lesson-document:operate',
  lesson: 'lesson:operate',
  materials: 'materials:operate',
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
  requestFocusDocument: 'app:request-focus-document',
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
  externalMcp: {
    grant: input => invoke(IPC_CHANNELS.externalMcp, { type: 'grant', ...input }),
    list: input => invoke(IPC_CHANNELS.externalMcp, { type: 'list', ...input }),
    revoke: input => invoke(IPC_CHANNELS.externalMcp, { type: 'revoke', ...input }),
    handoff: input => invoke(IPC_CHANNELS.externalMcp, { type: 'handoff', ...input }),
  },
  attachments: {
    clipboardFiles: input => invoke(IPC_CHANNELS.attachments, { type: 'clipboard-files', ...input }),
    workspaceFiles: input => invoke(IPC_CHANNELS.attachments, { type: 'workspace-files', ...input }),
    receiveGranted: input => invoke(IPC_CHANNELS.attachments, { type: 'receive-granted', ...input }),
    subscribeProgress(listener) {
      const receive = (_event: Electron.IpcRendererEvent, progress: AttachmentReadProgress) => listener(progress)
      ipcRenderer.on(`${IPC_CHANNELS.attachments}:progress`, receive)
      return () => ipcRenderer.removeListener(`${IPC_CHANNELS.attachments}:progress`, receive)
    },
    release: authorizationIds => invoke(IPC_CHANNELS.attachments, { type: 'release', authorizationIds }),
    select: () => invoke(IPC_CHANNELS.attachments, { type: 'select' }),
    receive: input => invoke(IPC_CHANNELS.attachments, { type: 'receive', ...input }),
    snapshot: attachmentId => invoke(IPC_CHANNELS.attachments, { type: 'snapshot', attachmentId }),
    readRepresentation: (attachmentId, representationId) => invoke(IPC_CHANNELS.attachments, { type: 'representation', attachmentId, representationId }),
    extract: input => invoke(IPC_CHANNELS.attachments, { type: 'extract', ...input }),
    cancel: requestId => invoke(IPC_CHANNELS.attachments, { type: 'cancel', requestId }),
  },
  imageResults: {
    list: input => invoke(IPC_CHANNELS.imageResults, { type: 'list', ...input }),
    read: input => invoke(IPC_CHANNELS.imageResults, { type: 'read', ...input }),
    stop: input => invoke(IPC_CHANNELS.imageResults, { type: 'stop', ...input }),
    preview: input => invoke(IPC_CHANNELS.imageResults, { type: 'preview', ...input }),
    apply: input => invoke(IPC_CHANNELS.imageResults, { type: 'apply', ...input }),
    edit: input => invoke(IPC_CHANNELS.imageResults, { type: 'edit', ...input }),
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) => listener(value)
      ipcRenderer.on(IPC_CHANNELS.imageResultsChanged, receive)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.imageResultsChanged, receive)
    },
  },
  execution: {
    workspace: root => invoke(IPC_CHANNELS.execution, { type: 'workspace', root }),
    conversations: workspaceId => invoke(IPC_CHANNELS.execution, { type: 'conversations', workspaceId }),
    createConversation: (workspaceId, title, home) => invoke(IPC_CHANNELS.execution, { type: 'create-conversation', workspaceId, title, ...(home ? { home } : {}) }),
    setConversationHome: input => invoke(IPC_CHANNELS.execution, { type: 'set-conversation-home', ...input }),
    conversation: (workspaceId, conversationId) => invoke(IPC_CHANNELS.execution, { type: 'conversation', workspaceId, conversationId }),
    draft: input => invoke(IPC_CHANNELS.execution, { type: 'draft', ...input }),
    renameConversation: input => invoke(IPC_CHANNELS.execution, { type: 'rename-conversation', ...input }),
    deleteConversation: input => invoke(IPC_CHANNELS.execution, { type: 'delete-conversation', ...input }),
    send: input => invoke(IPC_CHANNELS.execution, { type: 'send', ...input }),
    timing: input => invoke(IPC_CHANNELS.execution, { type: 'timing', ...input }),
    submission: input => invoke(IPC_CHANNELS.execution, { type: 'submission', ...input }),
    submissions: input => invoke(IPC_CHANNELS.execution, { type: 'submissions', ...input }),
    deleteSubmission: input => invoke(IPC_CHANNELS.execution, { type: 'delete-submission', ...input }),
    pauseQueue: input => invoke(IPC_CHANNELS.execution, { type: 'pause-queue', ...input }),
    resumeQueue: input => invoke(IPC_CHANNELS.execution, { type: 'resume-queue', ...input }),
    run: runId => invoke(IPC_CHANNELS.execution, { type: 'run', runId }),
    stop: runId => invoke(IPC_CHANNELS.execution, { type: 'stop', runId }),
    answer: input => invoke(IPC_CHANNELS.execution, { type: 'answer', ...input }),
    approve: input => invoke(IPC_CHANNELS.execution, { type: 'approve', ...input }),
    events: (conversationId, after, limit) => invoke(IPC_CHANNELS.execution, { type: 'events', conversationId, after, limit }),
    searchEvents: input => invoke(IPC_CHANNELS.execution, { type: 'search-events', ...input }),
    timeline: conversationId => invoke(IPC_CHANNELS.execution, { type: 'timeline', conversationId }),
    blob: (conversationId, ref) => invoke(IPC_CHANNELS.execution, { type: 'blob', conversationId, ref }),
    edits: documentId => invoke(IPC_CHANNELS.execution, { type: 'edits', documentId }),
    subscribe: listener => {
      const receive = (_event: Electron.IpcRendererEvent, event: import('../shared/workbench/executionEvents').ExecutionEvent) => listener(event)
      ipcRenderer.on(IPC_CHANNELS.executionEvent, receive)
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.executionEvent, receive) }
    },
    subscribeEdits: listener => {
      const receive = (_event: Electron.IpcRendererEvent, event: import('../shared/workbench/editSession').EditEvent) => listener(event)
      ipcRenderer.on(IPC_CHANNELS.executionEdit, receive)
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.executionEdit, receive) }
    },
  },
  executionSettings: {
    startOAuthLogin: (id, revision) => invoke(IPC_CHANNELS.executionSettings, { type: 'oauth-login-start', id, revision }),
    oauthLoginStatus: loginId => invoke(IPC_CHANNELS.executionSettings, { type: 'oauth-login-status', loginId }),
    cancelOAuthLogin: loginId => invoke(IPC_CHANNELS.executionSettings, { type: 'oauth-login-cancel', loginId }),
    read: () => invoke(IPC_CHANNELS.executionSettings, { type: 'read' }),
    saveConnection: input => invoke(IPC_CHANNELS.executionSettings, { type: 'save-connection', input }),
    saveProfile: input => invoke(IPC_CHANNELS.executionSettings, { type: 'save-profile', input }),
    revokeConnection: id => invoke(IPC_CHANNELS.executionSettings, { type: 'revoke-connection', id }),
    discoverModels: (id, revision) => invoke(IPC_CHANNELS.executionSettings, { type: 'discover-models', id, revision }),
    probeCapabilities: input => invoke(IPC_CHANNELS.executionSettings, { type: 'probe-capabilities', ...input }),
  },
  documents: {
    list: () => invoke(IPC_CHANNELS.documents, { type: 'list' }),
    bootstrapCourse: () => invoke(IPC_CHANNELS.documents, { type: 'bootstrap-course' }),
    create: (model, suggestedName) => invoke(IPC_CHANNELS.documents, { type: 'create', model, suggestedName }),
    open: path => invoke(IPC_CHANNELS.documents, { type: 'open', path }),
    read: documentId => invoke(IPC_CHANNELS.documents, { type: 'read', documentId }),
    dispatch: operation => invoke(IPC_CHANNELS.documents, { type: 'dispatch', operation }),
    lookup: (documentId, operationId) => invoke(IPC_CHANNELS.documents, { type: 'lookup', documentId, operationId }),
    save: (documentId, path) => invoke(IPC_CHANNELS.documents, { type: 'save', documentId, ...(path ? { path } : {}) }),
    saveWithDialog: (documentId, saveAs, suggestedDirectory) => invoke(IPC_CHANNELS.documents, { type: 'save-dialog', documentId,
      ...(saveAs === undefined ? {} : { saveAs }), ...(suggestedDirectory ? { suggestedDirectory } : {}) }),
    observeFile: documentId => invoke(IPC_CHANNELS.documents, { type: 'observe-file', documentId }),
    reconcileFile: input => invoke(IPC_CHANNELS.documents, { type: 'reconcile-file', ...input }),
    close: (documentId, discardDirty) => invoke(IPC_CHANNELS.documents, { type: 'close', documentId, ...(discardDirty === undefined ? {} : { discardDirty }) }),
    closeWithDialog: (documentId, suggestedDirectory) => invoke(IPC_CHANNELS.documents, { type: 'close-dialog', documentId,
      ...(suggestedDirectory ? { suggestedDirectory } : {}) }),
    recoverable: () => invoke(IPC_CHANNELS.documents, { type: 'recoverable' }),
    restore: documentId => invoke(IPC_CHANNELS.documents, { type: 'restore', documentId }),
    discardRecovery: documentId => invoke(IPC_CHANNELS.documents, { type: 'discard-recovery', documentId }),
    subscribe: listener => {
      const receive = (_event: Electron.IpcRendererEvent, event: import('../shared/workbench/document').DocumentEvent) => listener(event)
      ipcRenderer.on(IPC_CHANNELS.documentEvent, receive)
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.documentEvent, receive) }
    },
  },
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
    readResource: (ref, relativePath) => invoke(IPC_CHANNELS.lessonDocument, { operation: 'read-resource', ref, relativePath }),
    openDocument: ref => invoke(IPC_CHANNELS.lessonDocument, { operation: 'open', ref }),
    saveDocument: request => invoke(IPC_CHANNELS.lessonDocument, { operation: 'save', request }),
    readRecovery: ref => invoke(IPC_CHANNELS.lessonDocument, { operation: 'recovery', ref }),
    preserveDraft: (ref, source, expectedVersion, attachments) => invoke(IPC_CHANNELS.lessonDocument, { operation: 'preserve', ref, source, expectedVersion, attachments }),
  },
  workspaceFiles: input => invoke(IPC_CHANNELS.workspaceFiles, input),
  onWorkspaceFilesChanged: listener => {
    const receive = (_event: Electron.IpcRendererEvent, event: import('../shared/workbench/workspaceFiles').WorkspaceFilesChange) => listener(event)
    ipcRenderer.on(IPC_CHANNELS.workspaceFilesChanged, receive)
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.workspaceFilesChanged, receive) }
  },
  lesson: (input) => invoke(IPC_CHANNELS.lesson, input),
  legacyPpt: (input) => invoke(IPC_CHANNELS.legacyPpt, input),
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
  onRequestFocusDocument: handler => {
    const listener = (_event: Electron.IpcRendererEvent, id: unknown) => { if (typeof id === 'string' && id.length > 0 && id.length <= 512) handler(id) }
    ipcRenderer.on(IPC_CHANNELS.requestFocusDocument, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.requestFocusDocument, listener)
  },
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
      void Promise.resolve().then(handler).then(result => {
        const ready = result === true || typeof result === 'object' && result.ready === true
        const suggestedDirectory = typeof result === 'object' ? result.suggestedDirectory : undefined
        ipcRenderer.send(IPC_CHANNELS.preserveAndCloseResult, requestId, ready, suggestedDirectory)
      }, () => ipcRenderer.send(IPC_CHANNELS.preserveAndCloseResult, requestId, false))
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
