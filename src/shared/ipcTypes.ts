import type { MaterialRequest, MaterialRecordV1 } from './materialContract'
import type { DynamicAdmissionRequest, DynamicAdmissionResult } from './dynamicAdmissionContract'
import type { SaveDirectoryContext } from './workbench/desktop'
import type {
  ComponentCatalogPackageFile,
  ComponentCatalogSnapshot,
} from './componentCatalog'

export interface OpenBinaryFileResult {
  path: string
  name: string
  bytes: Uint8Array
}

export interface LegacyPptImportResult { name: string; bytes: Uint8Array }

export interface OpenProjectFileResult extends OpenBinaryFileResult {
  /** Opaque, process-local acknowledgement for one project-open attempt. */
  confirmationId: string
}

export interface ConfirmProjectOpenInput {
  confirmationId: string
}

export interface SaveBinaryFileInput {
  suggestedDirectory?: string
  path?: string
  suggestedName: string
  bytes: Uint8Array
}

export interface SaveBinaryFileResult {
  path: string
}

export type PreserveAndCloseResult = boolean | { ready: boolean; suggestedDirectory?: SaveDirectoryContext }

export interface SelectedImageResult extends OpenBinaryFileResult {
  mimeType: string
}

export interface SelectedMediaResult extends OpenBinaryFileResult {
  mimeType: string
}

export interface BatchFileDigest {
  /** SHA-256 of the exact selected bytes, encoded as lowercase hexadecimal. */
  sha256: string
}

export type SelectedBinaryBatchFile = OpenBinaryFileResult & BatchFileDigest
export type SelectedImageBatchFile = SelectedImageResult & BatchFileDigest
export type SelectedMediaBatchFile = SelectedMediaResult & BatchFileDigest

export interface BatchFileRejection {
  path: string
  name: string
  code: string
  title: string
  message: string
  suggestion: string
}

/**
 * A cancelled system dialog returns `null`. Once the user confirms a selection,
 * every path is represented exactly once in either `accepted` or `rejected`.
 */
export interface SelectedFileBatch<T extends OpenBinaryFileResult> {
  selectedCount: number
  acceptedByteLength: number
  accepted: T[]
  rejected: BatchFileRejection[]
}

export interface RecentProjectEntry {
  path: string
  name: string
  lastOpenedAt: number
}

export interface RecoveryProjectInput {
  projectName: string
  projectPath?: string
  bytes: Uint8Array
}

export interface RecoveryProjectResult extends RecoveryProjectInput {
  savedAt: number
}

export interface PreviewNetworkPolicyInput {
  leaseId: string
  connectOrigins: string[]
  remoteAssetUrls: string[]
}

export interface DesktopAPI {
  imageResults?: import('./workbench/imageResultsDesktop').ImageResultsDesktopAPI
  attachments?: import('./workbench/attachmentsDesktop').AttachmentsDesktopAPI
  execution?: import('./workbench/executionDesktop').ExecutionDesktopAPI
  externalMcp?: import('./workbench/external').ExternalMcpAPI
  executionSettings?: import('./workbench/executionSettingsDesktop').ExecutionSettingsAPI
  workspaceFiles?: import('./workbench/workspaceFiles').WorkspaceFilesAPI
  onWorkspaceFilesChanged?(listener: (event: import('./workbench/workspaceFiles').WorkspaceFilesChange) => void): () => void
  documents?: import('./workbench/desktop').DocumentHostAPI
  flowDocumentRecovery?: import('./flowDocumentRecovery').FlowDocumentRecoveryAPI
  lessonMaterials?: import('./lessonMaterialDesktop').LessonMaterialDesktopAPI
  lessonFiles?: import('./lessonDocumentDesktop').LessonDocumentDesktopAPI
  lesson?(input: import('./lessonDesktopContract').LessonDesktopRequest): Promise<import('./lessonDesktopContract').LessonDesktopResult>
  legacyPpt(input: { operation: 'select' | 'cancel' }): Promise<LegacyPptImportResult | null>
  captureAuthoringObservation?(input: { x: number; y: number; width: number; height: number }): Promise<{ dataUrl: string; capturedAt: number; width: number; height: number }>
  dynamicAdmission?(input: DynamicAdmissionRequest): Promise<DynamicAdmissionResult>
  materials(input: MaterialRequest): Promise<MaterialRecordV1[]>
  openProject(): Promise<OpenProjectFileResult | null>
  listRecentProjects(): Promise<RecentProjectEntry[]>
  openRecentProject(input: { path: string }): Promise<OpenProjectFileResult>
  confirmProjectOpen(input: ConfirmProjectOpenInput): Promise<void>
  saveProject(input: SaveBinaryFileInput): Promise<SaveBinaryFileResult | null>
  writeRecoveryProject(input: RecoveryProjectInput): Promise<void>
  readRecoveryProject(): Promise<RecoveryProjectResult | null>
  clearRecoveryProject(): Promise<void>
  selectImage(): Promise<SelectedImageResult | null>
  selectImages(): Promise<SelectedFileBatch<SelectedImageBatchFile> | null>
  selectAudio(): Promise<SelectedMediaResult | null>
  selectAudios(): Promise<SelectedFileBatch<SelectedMediaBatchFile> | null>
  selectVideo(): Promise<SelectedMediaResult | null>
  selectVideos(): Promise<SelectedFileBatch<SelectedMediaBatchFile> | null>
  selectComponentPackage(): Promise<OpenBinaryFileResult | null>
  selectComponentPackages(): Promise<SelectedFileBatch<SelectedBinaryBatchFile> | null>
  loadComponentCatalog(): Promise<ComponentCatalogSnapshot>
  selectComponentCatalogSource(): Promise<ComponentCatalogSnapshot | null>
  setComponentCatalogSourceTrust(input: {
    sourceId: string
    trust: 'trusted' | 'prompt'
  }): Promise<ComponentCatalogSnapshot>
  readComponentCatalogPackage(input: {
    sourceId: string
    packageId: string
    version: string
  }): Promise<ComponentCatalogPackageFile>
  exportHtml(input: {
    suggestedName: string
    html: string
  }): Promise<{ path: string } | null>
  exportWebPackage(input: {
    suggestedName: string
    bytes: Uint8Array
  }): Promise<{ path: string } | null>
  peekProjectArchive(input: { path: string }): Promise<OpenBinaryFileResult | null>
  exportBinary(input: {
    suggestedName: string
    extension: 'pptx' | 'json' | 'docx'
    bytes: Uint8Array
  }): Promise<{ path: string } | null>
  exportPdf(input: {
    suggestedName: string
    html: string
  }): Promise<{ path: string } | null>
  setPreviewNetworkPolicy(input: PreviewNetworkPolicyInput): Promise<void>
  releasePreviewNetworkPolicy(input: { leaseId: string }): Promise<void>
  confirmDiscardChanges(): Promise<'discard' | 'cancel'>
  setDirtyState(dirty: boolean): Promise<void>
  onRequestSave(handler: () => void): () => void
  onRequestFocusDocument?(handler: (documentId: string) => void): () => void
  onRequestPreserveAndClose?(handler: () => Promise<PreserveAndCloseResult>): () => void
  onRequestSaveAndClose(handler: () => Promise<boolean>): () => void
  reportDiagnostic(input: {
    source: 'renderer' | 'preview' | 'component'
    message: string
    stack?: string
  }): Promise<void>
  exportDiagnostics(): Promise<{ path: string } | null>
}

export const IPC_CHANNELS = {
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
