import type { CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import type { DocumentResources, DocumentOperationResult, DocumentSnapshot } from '../../shared/workbench/document'
import type { CourseV10DocumentBridge, CourseV10ViewState, CapturedCourseTarget, CapturedComponentOperation } from '../documents/CourseV10DocumentBridge'
export const SESSIONLESS_COURSE_REASON = '当前会话没有课程工程'

export type EditorFeedback = {
  errorMessage?: string | null
  statusMessage?: string | null
}

export interface CourseTransactionCommitPolicy {
  readonly preserveBrowsing?: boolean
}

export type EditorStoreKernel = {
  readonly bridge: CourseV10DocumentBridge
  tryReadDocument(): CourseProjectV10 | null
  readDocument(): CourseProjectV10
  readEditingDocument(): CourseProjectV10
  readView(): CourseV10ViewState
  readResources(): DocumentResources
  edit(edits: ComponentEdit[], historyGroup?: string, documentId?: string): Promise<DocumentOperationResult>
  captureTarget(documentId?: string): CapturedCourseTarget
  capture(edits: ComponentEdit[], target?: CapturedCourseTarget): CapturedComponentOperation
  editCaptured(command: CapturedComponentOperation, historyGroup?: string): Promise<DocumentOperationResult>
  selectInstances(instanceIds: readonly string[], surfaceId?: string | null, documentId?: string): void
  selectSurface(surfaceId: string, documentId?: string): void
  setFeedback(feedback: EditorFeedback): void
  readDirty(): boolean
  waitForCommit(): Promise<boolean>
  drain(): Promise<DocumentSnapshot[]>
  navigateHistory(direction: 'undo' | 'redo'): Promise<void>
  failSessionless(reason?: string): never
}

export type EditorStoreKernelHost = {
  bridge: CourseV10DocumentBridge
  commit(patch: EditorFeedback): void
}

/** The existing slices share the same document projection and Main-owned history. */
export function createEditorStoreKernel(host: EditorStoreKernelHost): EditorStoreKernel {
  const bridge = host.bridge
  return {
    bridge,
    tryReadDocument: () => bridge.read().project,
    readDocument() {
      const project = bridge.read().project
      if (!project) throw new Error(SESSIONLESS_COURSE_REASON)
      return project
    },
    readEditingDocument() { const project = bridge.read().editingProject; if (!project) throw new Error(SESSIONLESS_COURSE_REASON); return project },
    readView: bridge.read,
    readResources() {
      const view = bridge.read()
      return view.views.find(item => item.documentId === view.activeDocumentId)?.model.resources
        ?? view.snapshot?.model.resources ?? { assets: {}, components: {} }
    },
    edit: (edits, historyGroup, documentId) => bridge.edit(edits, historyGroup, documentId),
    captureTarget: documentId => bridge.captureTarget(documentId),
    capture: (edits, target) => bridge.capture(edits, target),
    editCaptured: (command, historyGroup) => bridge.editCaptured(command, historyGroup),
    selectInstances(instanceIds, surfaceId, documentId = bridge.read().activeDocumentId ?? '') {
      bridge.selectInstances(documentId, instanceIds, surfaceId)
    },
    selectSurface(surfaceId, documentId = bridge.read().activeDocumentId ?? '') {
      bridge.selectSurface(documentId, surfaceId)
    },
    setFeedback: host.commit,
    readDirty: () => Boolean(bridge.read().snapshot?.dirty || bridge.read().pending),
    waitForCommit: () => bridge.drain().then(() => true, () => false),
    drain: () => bridge.drain(),
    navigateHistory: direction => bridge[direction](),
    failSessionless(reason = SESSIONLESS_COURSE_REASON): never { throw new Error(reason) },
  }
}

