import { describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import { createTextNode } from '@/renderer/project/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument, NativeLayerItem } from '@/shared/courseProjectTypes'
import type { TextNode } from '@/shared/contracts/native-v1'
import {
  locateCourseLayer, makeEffectiveLayerAuthoringAddress, patchEffectiveLayerPropertiesAtTarget,
  type EffectiveLayerPropertiesPatchAtTarget,
} from '@/renderer/course/effectiveLayerCommands'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'
import { openSlideAuthoringSession } from '@/renderer/course/slideAuthoringBackend'
import { updateSlideNativeLayerContent } from '@/renderer/course/v9SlideContentCommands'
import {
  beginV9SlideContentEdit, updateV9SlideContentTextDraft, commitV9SlideContentEdit,
} from '@/renderer/authoring/v9SlideContentEdit'
import { undoResourceAwareAuthoringHistory, redoResourceAwareAuthoringHistory } from '@/renderer/authoring/resourceAwareAuthoringHistory'
import { normalizePropertiesPatch, propertiesViewFromLayerItem } from '@/renderer/ui/properties/propertiesItemView'

const TITLE = '教师手工保留：现在的标题'
type SurfaceType = 'slide' | 'flow' | 'spatial-2d'
function fixture(type: SurfaceType = 'slide', style: Partial<TextNode['style']> = {}) {
  const project = type === 'slide' ? createBlankCourseProject()
    : type === 'flow' ? createBlankFlowCourseProject() : createBlankSpatialCourseProject()
  const item = sceneNodeToCourseLayerItem(createTextNode({
    id: 'auto-title', text: TITLE, x: 260, y: 72, width: 760, height: 48.8,
    style: { fontSize: 40, padding: 0, lineSpacing: 6, overflow: 'auto-height', ...style },
  }), 10) as NativeLayerItem
  const surface = project.surfaces[0]!
  if (surface.type === 'slide') surface.scenes[0]!.layerItems.push(item)
  else if (surface.type === 'spatial-2d') surface.world.layerItems.push(item)
  else surface.surfaceLayerItems.push({ item, visibility: { mode: 'all', locationIds: [] } })
  return { project, item }
}
function apply(project: CourseProjectDocument, patch: EffectiveLayerPropertiesPatchAtTarget, stateId: string | null = null) {
  const located = locateCourseLayer(project, 'auto-title')!
  const result = patchEffectiveLayerPropertiesAtTarget(project, {
    authoringAddress: makeEffectiveLayerAuthoringAddress(project.id, located),
    locationId: project.startLocationId, stateId,
  }, patch, { expectedRevision: project.revision })
  expect(result.ok, result.reason).toBe(true)
  expect(result.nextDocument).toBeDefined()
  return result.nextDocument!
}
function textItem(project: CourseProjectDocument) {
  return locateCourseLayer(project, 'auto-title')!.item as NativeLayerItem & {
    content: { nativeType: 'text'; data: Pick<TextNode, 'text' | 'runs' | 'style'> }
  }
}

describe('Native content commands keep automatic text bounds current', () => {
  it.each<SurfaceType>(['slide', 'flow', 'spatial-2d'])('reflows a larger title in %s without moving it or changing its carrier', type => {
    const { project, item } = fixture(type)
    const before = structuredClone(project)
    const next = apply(project, { nativeData: { style: { fontSize: 48 } } })
    const changed = textItem(next)
    expect(changed.frame).toMatchObject({ x: 260, y: 72, width: 760 })
    expect(changed.frame.height).toBeCloseTo(58.56)
    expect(changed.content.data).toMatchObject({ text: TITLE, style: { fontSize: 48, overflow: 'auto-height' } })
    expect(project).toEqual(before)
    expect(next.revision).toBe(project.revision + 1)
    expect(locateCourseLayer(next, item.layerItemId)!.source).toBe(locateCourseLayer(project, item.layerItemId)!.source)
    expect(courseProjectDocumentSchema.parse(JSON.parse(JSON.stringify(next)))).toEqual(next)
    if (type === 'flow') expect(next.surfaces[0]).toMatchObject({ blocks: (project.surfaces[0] as { blocks: unknown }).blocks })
  })

  it('measures text, runs, spacing and the new wrapping width together', () => {
    const { project } = fixture()
    const twoLines = apply(project, { nativeData: { text: '甲\n乙', style: { lineSpacing: 20 } } })
    expect(textItem(twoLines).frame.height).toBeCloseTo(117.6)
    const styledRun = apply(twoLines, { nativeData: { runs: [{ start: 0, end: 1, style: { fontSize: 60 } }] } })
    expect(textItem(styledRun).frame.height).toBeCloseTo(142)
    const wrapped = apply(project, { frame: { x: 300, width: 96 }, nativeData: { text: '甲乙丙丁', style: { fontSize: 48 } } })
    expect(textItem(wrapped).frame).toMatchObject({ x: 300, y: 72, width: 96 })
    expect(textItem(wrapped).frame.height).toBeCloseTo(123.12)
  })

  it.each(['fixed', 'shrink'] as const)('retains the authored box in %s mode', overflow => {
    const { project, item } = fixture('slide', { overflow })
    const next = apply(project, { nativeData: { text: '甲\n乙', style: { fontSize: 64 } } })
    expect(textItem(next).frame).toEqual(item.frame)
  })

  it('honors an explicit automatic-axis size in the same edit and in the properties adapter', () => {
    const { project, item } = fixture()
    const next = apply(project, { frame: { width: 96, height: 72 }, nativeData: { text: '甲乙丙丁', style: { fontSize: 48 } } })
    expect(textItem(next).frame).toMatchObject({ width: 96, height: 72 })
    expect(normalizePropertiesPatch(propertiesViewFromLayerItem(item), { height: 72, style: { fontSize: 48 } })).toEqual({ height: 72, style: { fontSize: 48 } })
    expect(normalizePropertiesPatch(propertiesViewFromLayerItem(item), { style: { fontSize: 48 } })).toEqual({ height: 58.56, style: { fontSize: 48 } })
  })

  it('grows vertical text across columns while retaining the authored height', () => {
    const { project, item } = fixture('spatial-2d', { writingMode: 'vertical-rl', fontSize: 20, lineSpacing: 0 })
    item.frame.height = 80
    const next = apply(project, { nativeData: { text: '甲乙丙丁戊己庚' } })
    expect(textItem(next).frame).toMatchObject({ x: 260, y: 72, width: 60, height: 80 })
  })

  it('uses effective named-state text and width, then removes derived overrides when they return to base', () => {
    const { project, item } = fixture()
    const surface = project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('Expected Slide')
    surface.scenes[0]!.presentation = { initialStateId: 'a', states: [
      { id: 'a', name: '状态A', layerItemOverrides: { [item.layerItemId]: { frame: { width: 96 }, nativeData: { text: '甲乙丙丁', style: { fontSize: 24 } } } } },
      { id: 'b', name: '状态B', layerItemOverrides: { [item.layerItemId]: { visible: false } } },
    ] }
    const next = apply(project, { nativeTextStyle: { fontSize: 48 }, nativeData: { style: { bold: false } } }, 'a')
    const effective = projectEffectiveLayers({ project: next, locationId: next.startLocationId, stateId: 'a' }).unifiedRows.find(row => row.id === item.layerItemId)!.item
    expect(effective.frame.width).toBe(96)
    expect(effective.frame.height).toBeCloseTo(123.12)
    expect(textItem(next)).toEqual(item)
    const nextSurface = next.surfaces[0]!
    if (nextSurface.type !== 'slide') throw new Error('Expected Slide')
    expect(nextSurface.scenes[0]!.presentation!.states[1]).toEqual(surface.scenes[0]!.presentation!.states[1])
    const restored = apply(next, { frame: { width: 760 }, nativeData: { text: TITLE, style: { fontSize: 40 } } }, 'a')
    const restoredSurface = restored.surfaces[0]!
    if (restoredSurface.type !== 'slide') throw new Error('Expected Slide')
    expect(restoredSurface.scenes[0]!.presentation!.states[0]!.layerItemOverrides[item.layerItemId]).toBeUndefined()
  })

  it('commits the direct content command and draft command through one undoable text-and-frame change', () => {
    const { project } = fixture()
    const session = openSlideAuthoringSession(project)
    const result = updateSlideNativeLayerContent(session, 'auto-title', { nativeData: { style: { fontSize: 48 } } })
    expect(result.ok, result.reason).toBe(true)
    const changed = result.nextSession!
    expect(changed.history.past).toHaveLength(1)
    expect(textItem(changed.history.present).frame.height).toBeCloseTo(58.56)
    const undone = undoResourceAwareAuthoringHistory(changed.history)
    expect(undone.present).toEqual(project)
    expect(redoResourceAwareAuthoringHistory(undone).present).toEqual(changed.history.present)

    const begun = beginV9SlideContentEdit({ session: changed, layerItemId: 'auto-title' })
    if (!begun.ok) throw new Error(begun.reason)
    const draft = updateV9SlideContentTextDraft(begun.edit, { text: '甲\n乙', runs: [] })
    const committed = commitV9SlideContentEdit(changed, draft)
    expect(committed.ok, committed.reason).toBe(true)
    expect(committed.nextSession!.history.past).toHaveLength(2)
    expect(textItem(committed.nextSession!.history.present).frame.height).toBeCloseTo(123.12)
    expect(undoResourceAwareAuthoringHistory(committed.nextSession!.history).present).toEqual(changed.history.present)
  })
})
