import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import { addCourseScene, addCourseSlidePage } from '../course/courseLocationCommands'
import { commitCourseProjectMutation } from '../course/courseProjectMutation'
import { createEditorTransactionStep } from '../authoring/editorTransaction'
import { applyCourseAssetImports } from './v9AssetAdapter'
import type { PptxImportDraft } from './pptxImport'

/** All page and media planning is private. The caller commits this single step. */
export function planPptxImportTransaction(project: CourseProjectDocument, draft: PptxImportDraft, title: string) {
  if (!draft.slides.length) throw new Error('没有可导入的页面')
  let next = commitCourseProjectMutation(project, projectDraft => { applyCourseAssetImports(projectDraft.assets, {}, draft.assets) })
  let surfaceId = '', firstLocationId = ''
  for (const [index, slide] of draft.slides.entries()) {
    const added = index === 0 ? addCourseSlidePage(next, { title }) : addCourseScene(next, { surfaceId, title: slide.title })
    if (!added.ok) throw new Error(added.reason)
    next = added.project
    const location = next.locations.find(l => l.id === added.activatedLocationId)
    if (!location || location.kind !== 'slide-scene') throw new Error('导入页面位置失效')
    surfaceId = location.surfaceId
    firstLocationId ||= location.id
    next = commitCourseProjectMutation(next, projectDraft => {
      const surface = projectDraft.surfaces.find(s => s.id === surfaceId)
      if (!surface || surface.type !== 'slide') throw new Error('导入表面失效')
      const scene = surface.scenes.find(s => s.id === location.sceneId)!
      scene.name = slide.title
      scene.backgroundColor = slide.backgroundColor
      scene.layerItems = structuredClone(slide.items)
      projectDraft.locations.find(l => l.id === location.id)!.label = slide.title
    })
  }
  const nextDocument = commitCourseProjectMutation(project, projectDraft => {
    Object.assign(projectDraft, structuredClone(next))
  })
  const step = createEditorTransactionStep(project, {
    projectId: project.id, baseRevision: project.revision, nextDocument,
    resourceChanges: { assetFileChanges: draft.assets.map(asset => ({ assetId: asset.meta.id, after: asset.bytes })) },
    selectionHint: { kind: 'authoring-tool-selection', locationId: firstLocationId, stateId: null, owner: 'scene', itemIds: [] },
  })
  if (!step) throw new Error('导入没有产生页面')
  return step
}
