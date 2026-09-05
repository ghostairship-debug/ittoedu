import { describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { projectWithBackgroundPreview, type BackgroundPreview } from '@/renderer/authoring/backgroundPreview'
import { buildSlideEditorView, openSlideAuthoringSession, makeSlideAuthoringTarget } from '@/renderer/course/slideAuthoringBackend'
import { patchSlideLayerPropertiesAtTarget } from '@/renderer/course/v9SlideContentCommands'
import { createTextNode } from '@/renderer/project/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { mergeCourseNativeData } from '@/shared/contracts/course-project-v9/schema'
import type { SlideSurfaceDocument } from '@/shared/courseProjectTypes'
import { createCourseProjectArchive, openCourseProjectArchive } from '@/renderer/project/courseProjectArchive'

function fixture() {
  const project = createBlankCourseProject()
  const surface = project.surfaces[0] as SlideSurfaceDocument
  const scene = surface.scenes[0]!
  const locationId = project.startLocationId
  return { project, surface, scene, locationId }
}

describe('owner-scoped background draft', () => {
  it.each([false, true])('previews a Native color without changing history or its base (state: %s)', named => {
    const { project, scene, locationId } = fixture()
    const node = createTextNode({ id: 'preview-text', style: { color: '#112233' } })
    scene.layerItems.push(sceneNodeToCourseLayerItem(node))
    const stateId = named ? scene.presentation!.states[0]!.id : null
    const opened = openSlideAuthoringSession(project)
    const session = { ...opened, selection: { ...opened.selection, stateId } }
    const address = makeSlideAuthoringTarget(session, node.id, 'item').authoringAddress
    const preview: BackgroundPreview = { target: { projectId: project.id, revision: project.revision, locationId,
      stateId, generation: session.generation, owner: 'native', authoringAddress: address }, color: '', nativeData: { style: { color: '#abcdef' } } }
    const candidate = projectWithBackgroundPreview(project, preview, { locationId, stateId, generation: session.generation })
    const painted = buildSlideEditorView({ project: candidate, locationId, stateId }).layers.find(layer => layer.selectionId === node.id)!.item
    expect(painted.kind === 'native' && painted.content.nativeType === 'text' && painted.content.data.style.color).toBe('#abcdef')
    expect(candidate.revision).toBe(project.revision)
    expect(projectWithBackgroundPreview(project, null, { locationId, stateId, generation: session.generation })).toBe(project)
    const original = scene.layerItems[0]!
    expect(original.kind === 'native' && original.content.nativeType === 'text' && original.content.data.style.color).toBe('#112233')
  })
  it('respects the background inheritance chain and never mutates the document', () => {
    const { project, surface, scene, locationId } = fixture()
    project.backgroundColor = '#112233'
    scene.backgroundColor = '#abcdef'
    scene.backgroundMode = 'own'
    surface.backgroundMode = 'inherit'
    const preview: BackgroundPreview = { color: '#ff0000', target: {
      projectId: project.id, revision: project.revision, generation: 0, locationId, stateId: null, owner: 'course',
    } }
    const color = () => buildSlideEditorView({ project: projectWithBackgroundPreview(project, preview, {
      locationId, stateId: null, generation: 0,
    }), locationId, stateId: null }).backgroundColor
    expect(color()).toBe('#abcdef')
    scene.backgroundMode = 'inherit'
    expect(color()).toBe('#ff0000')
    expect(project.backgroundColor).toBe('#112233')
  })

  it.each(['revision', 'generation', 'location', 'state'] as const)('rejects a stale %s preview', change => {
    const { project, locationId } = fixture()
    const preview: BackgroundPreview = { color: '#ff0000', target: {
      projectId: project.id, revision: project.revision, generation: 0, locationId, stateId: null, owner: 'slide-scene',
    } }
    const current = { locationId, stateId: null as string | null, generation: 0 }
    if (change === 'revision') project.revision++
    if (change === 'generation') current.generation++
    if (change === 'location') current.locationId = 'different-location'
    if (change === 'state') current.stateId = 'different-state'
    expect(projectWithBackgroundPreview(project, preview, current)).toBe(project)
  })
})

describe('nullable Native highlight commits', () => {
  it.each([false, true])('clears highlighting and reopens the legal V9 result (named state: %s)', named => {
    const { project, scene, locationId } = fixture()
    const node = createTextNode({ id: 'highlighted', style: { highlightColor: '#ffee00' } })
    scene.layerItems.push(sceneNodeToCourseLayerItem(node))
    const opened = openSlideAuthoringSession(project)
    const stateId = named ? scene.presentation!.states[0]!.id : null
    const session = { ...opened, selection: { ...opened.selection, stateId, selectionIds: [node.id] } }
    const target = makeSlideAuthoringTarget(session, node.id, 'item')
    const result = patchSlideLayerPropertiesAtTarget(session, target, { nativeData: { style: { highlightColor: null } } })
    expect(result.ok, result.reason).toBe(true)
    const next = result.nextSession!.history.present
    const reopened = openCourseProjectArchive(createCourseProjectArchive({ project: next, assetFiles: {}, componentFiles: {} })).project
    const readColor = (state: string | null) => {
      const item = buildSlideEditorView({ project: reopened, locationId, stateId: state }).layers.find(entry => entry.selectionId === node.id)!.item
      if (item.kind !== 'native' || item.content.nativeType !== 'text') throw new Error('Missing text')
      return item.content.data.style.highlightColor
    }
    expect(readColor(stateId)).toBeNull()
    if (named) expect(readColor(null)).toBe('#ffee00')
  })

  it('retains deletion semantics for optional fields', () => {
    expect(mergeCourseNativeData({ style: { valueMin: 12, highlightColor: '#ffff00' } }, {
      style: { valueMin: null, highlightColor: null },
    })).toEqual({ style: { highlightColor: null } })
  })
})
