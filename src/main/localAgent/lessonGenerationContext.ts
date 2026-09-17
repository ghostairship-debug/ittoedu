import type { LessonIdentity } from '../../shared/lessonWorkspace'
import type { LessonAuthoring } from '../lessonAuthoring'
import type { LessonAuthoringOptions } from '../lessonAuthoring'
import type { GenerationRequest } from '../../shared/generationContract'

/** Read through the document/material owners on every native turn; no cached body. */
export async function readLessonGenerationContext(lesson: LessonIdentity, deps: LessonAuthoringOptions & { authoring: LessonAuthoring }, requireBuild: boolean) {
  const view = await deps.authoring.read(lesson)
  if (requireBuild) {
    const check = await deps.authoring.validateBuild(lesson, view.state.epoch)
    if (!check.allowed) throw new Error(check.issues.join('；'))
  }
  const documents = []
  for (const item of view.documents) {
    const disk = await deps.files.openDocument({ kind: 'lesson' as const, lessonId: lesson.lessonId, lessonDirectory: lesson.normalizedDirectory, relativePath: item.relativePath })
    if (JSON.stringify(disk.version) !== JSON.stringify(item.version)) throw new Error('当前教学文件在读取期间改变，请重新确认')
    documents.push({ role: item.role, path: item.relativePath, status: item.status, content: disk.source, version: disk.version })
  }
  const materials = [], resourceFiles: NonNullable<GenerationRequest['resourceFiles']> = []
  const materialRecords = await deps.materials.list({ lessonId: lesson.lessonId, rootPath: lesson.normalizedDirectory })
  for (const selection of view.state.materials) {
    const receipt = await deps.materials.read({ lessonId: lesson.lessonId, rootPath: lesson.normalizedDirectory }, selection)
    materials.push({ materialId: receipt.materialId, sourceVersion: receipt.sourceVersion, extractionVersion: receipt.extractionVersion, readAt: receipt.readAt, fragments: receipt.fragments,
      assets: receipt.assets.map(asset => ({ id: asset.id, sourcePath: materialRecords.find(record => record.id === receipt.materialId)?.assets.find(item => item.id === asset.id)?.path, resourcePath: `lesson-materials/${receipt.materialId}/${asset.id}` })) })
    for (const asset of receipt.assets) resourceFiles.push({ path: `lesson-materials/${receipt.materialId}/${asset.id}`, encoding: 'base64', content: Buffer.from(asset.bytes).toString('base64'), mediaType: asset.mime, role: 'material' })
  }
  if (requireBuild) {
    const check = await deps.authoring.validateBuild(lesson, view.state.epoch)
    if (!check.allowed) throw new Error(check.issues.join('；'))
  }
  const confirmedDocuments = requireBuild ? { teachingPlan: documents.find(item => item.role === 'teaching-plan')!.content, presentationScript: documents.find(item => item.role === 'presentation-script')!.content } : undefined
  const context = { lessonId: lesson.lessonId, directory: lesson.normalizedDirectory, mode: view.state.mode, currentStage: view.currentStage, issues: view.issues, epoch: view.state.epoch, documents, materials }
  if (Buffer.byteLength(JSON.stringify(context)) > 160000) throw new Error('当前课例材料超过单轮输入预算，请缩小引用范围')
  return { context, resourceFiles, confirmedDocuments }
}
