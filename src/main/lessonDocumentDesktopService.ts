import { app } from 'electron'
import path from 'node:path'
import { lessonDocumentRequestSchema } from '../shared/lessonDocumentDesktop'
import { createLessonDocumentFiles } from './lessonDocumentFiles'
import { LessonWorkspaceService } from './lessonWorkspace'
import { createWorkspaceIdentity } from './workspaceIdentity'

let files: ReturnType<typeof createLessonDocumentFiles> | undefined
export function lessonDocumentFiles() {
  if (!files) {
    const workspaces = new LessonWorkspaceService(app.getPath('userData'))
    files = createLessonDocumentFiles({ recoveryDirectory: path.join(app.getPath('userData'), 'lesson-document-recovery', 'v1'),
      validateTarget: async ref => {
        const directory = createWorkspaceIdentity(ref.lessonId, ref.lessonDirectory).normalizedPath
        await workspaces.read({ schemaVersion: 1, lessonId: ref.lessonId, normalizedDirectory: directory })
      },
    })
  }
  return files
}
export async function operateLessonDocument(request: unknown) {
  const input = lessonDocumentRequestSchema.parse(request), owner = lessonDocumentFiles()
  switch (input.operation) {
    case 'read-ai-records': return owner.readAiRecords(input.ref)
    case 'clear-ai-records': return owner.clearAiRecords(input.ref, input.ids)
    case 'invalidate': return owner.invalidateAiEdits(input.ref)
    case 'read-resource': return owner.readResource(input.ref, input.relativePath)
    case 'open': return owner.openDocument(input.ref)
    case 'save': return owner.saveDocument(input.request)
    case 'prepare': return owner.prepareAiEdit(input.ref, input.ranges, input.epoch)
    case 'apply': return owner.applyAiEdit(input.request)
    case 'revert': return owner.revertAiEdit(input.record, input.currentVersion)
    case 'recovery': return owner.readRecovery(input.ref)
    case 'preserve': return owner.preserveDraft(input.ref, input.source, input.expectedVersion, input.attachments)
  }
}
