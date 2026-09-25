import { useEditorStore, selectActiveCourseProjectDocument, selectEffectiveLayerProjection, selectMediaAssetFiles } from '../../../src/renderer/store/editorStore'
import { createAuthoringObservationController } from '../../../src/renderer/authoring/generation/authoringObservation'
import type { AuthoringObservationCaptureRect } from '../../../src/shared/authoringObservation'
import type { DocumentCommand } from '../../../src/shared/workbench/document'
import type { CourseProjectDocument } from '../../../src/shared/courseProjectTypes'
import type { ModelToolCall } from '../../../src/shared/workbench/tools'

/** Test adapter over the production read-only painter observer. No Agent request/candidate lifecycle. */
export function createCurrentObservation(captureRects?: AuthoringObservationCaptureRect[]) {
  return createAuthoringObservationController({
    read() {
      const state = useEditorStore.getState(), document = selectActiveCourseProjectDocument(state)
      const projection = selectEffectiveLayerProjection(state), session = state.courseAuthoringSession
      if (!document || !projection || !session) return null
      return { document, sessionGeneration: session.token.generation, surfaceId: projection.surfaceId,
        locationId: projection.locationId, stateId: projection.stateId, selectedIds: session.itemIds,
        draft: projection.surfaceType === 'slide' ? state.v9ContentEdit : projection.surfaceType === 'flow'
          ? state.flowDocumentDraft ?? state.flowTextEdit : state.spatialContentEdit,
        assetFiles: selectMediaAssetFiles(state), componentPackages: state.componentPackages,
        previewBackgroundColor: state.previewBackgroundColor,
        ...(state.spatialSession ? { spatialCamera: state.spatialSession.sessionCamera } : {}) }
    },
    prepareForEdit: () => useEditorStore.getState().prepareCourseProjectPersistence(),
    materializeDraft: () => useEditorStore.getState().captureCourseProjectObservationSnapshot(),
    captureImage(rect) {
      if (!window.desktopAPI.captureAuthoringObservation) throw new Error('Actual Main image capture is unavailable')
      captureRects?.push({ ...rect })
      return window.desktopAPI.captureAuthoringObservation(rect)
    },
  })
}

export async function readCanonicalCourse() {
  const id = useEditorStore.getState().courseDocument.documentId
  if (!id) throw new Error('No active main document')
  const api = window.desktopAPI.documents
  if (!api) throw new Error('Formal document service unavailable')
  const snapshot = await api.read(id)
  if (snapshot.model.kind !== 'course-v9') throw new Error('Expected a course document')
  return { ...snapshot, model: snapshot.model }
}

export async function commitCourseCommand(command: DocumentCommand) {
  const before = await useEditorStore.getState().drainCourseDocument()
  const api = window.desktopAPI.documents
  if (!api) throw new Error('Formal document service unavailable')
  const receipt = await api.dispatch({ documentId: before.documentId, epoch: before.epoch,
    baseRevision: before.revision, operationId: crypto.randomUUID(), actor: 'human', mutation: { type: 'command', command } })
  if ('message' in receipt) throw new Error(`${receipt.status}: ${receipt.message}`)
  return receipt
}

export type CurrentObservation = Awaited<ReturnType<ReturnType<typeof createCurrentObservation>['capture']>>

export async function stageCourseBuild(project: CourseProjectDocument, files: Record<string, Uint8Array> = {}) {
  const before = await useEditorStore.getState().drainCourseDocument(), runId = crypto.randomUUID()
  const target = await window.g20HostTool({ kind: 'begin', runId, documentId: before.documentId, target: { kind: 'document' } })
  if (typeof target !== 'string') throw new Error('Gateway did not issue a document handle')
  const call = async (call: ModelToolCall) => {
    const result = await window.g20HostTool({ kind: 'call', runId, call })
    if (!result || typeof result === 'string') throw new Error('Missing tool receipt')
    if (result.kind === 'error') throw new Error(`${result.code}: ${result.message}`)
    return result
  }
  const read = async (input: ModelToolCall) => {
    const result = await call(input)
    if (result.kind !== 'read' || !result.data || typeof result.data !== 'object') throw new Error('Missing actual build result')
    return result.data as Record<string, unknown>
  }
  const created = await read({ name: 'build.create', input: { target } }), job = created.job
  if (typeof job !== 'string') throw new Error('No build job handle')
  await call({ name: 'build.write', input: { job, path: 'project.json', content: JSON.stringify({ ...project, revision: before.revision }), encoding: 'utf8' } })
  for (const [path, bytes] of Object.entries(files)) {
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
    await call({ name: 'build.write', input: { job, path, content: btoa(binary), encoding: 'base64' } })
  }
  const checked = await read({ name: 'build.check', input: { job } })
  const logs = await read({ name: 'build.logs', input: { job } })
  const artifact = checked.status === 'ready' && typeof checked.artifact === 'string'
    ? await window.g20HostTool({ kind: 'artifact', runId, job, artifact: checked.artifact }) : null
  const admission = artifact && typeof artifact !== 'string' && artifact.kind === 'read'
    ? (artifact.data as import('../../../src/shared/workbench/build').BuildImportArtifact).admission : null
  return { before, checked, logs, admission, runId,
    stop: () => window.g20HostTool({ kind: 'stop', runId }),
    async commit() {
      if (checked.status !== 'ready' || typeof checked.artifact !== 'string') throw new Error(`Build was not admitted: ${JSON.stringify(logs)}`)
      const result = await call({ name: 'build.import', input: { job, artifact: checked.artifact } })
      if (result.kind !== 'document-operation') throw new Error('Build import did not return a document receipt')
      if ('message' in result.result) throw new Error(`${result.result.status}: ${result.result.message}`)
      return result.result
    },
  }
}
