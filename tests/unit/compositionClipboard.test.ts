import { expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createBlankSpatialCourseProject } from '../../src/renderer/project/createSpatialCourseProject'
import { copySlideSceneClipboard, mutatePasteSlideSceneClipboard } from '../../src/core/tools/slideClipboard'
import { duplicateSpatialLayers } from '../../src/renderer/course/spatialClipboardCommands'
import { openSpatialAuthoringSession } from '../../src/renderer/course/spatialEditorCommands'
import { propertiesViewFromLayerItem, effectivePatchFromProperties } from '../../src/renderer/ui/properties/propertiesItemView'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { CompositionLayerItem, CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import { walkComposition } from '../../src/shared/composition/content'

function composition(project: CourseProjectDocument): CompositionLayerItem {
  project.assets.photo = { id: 'photo', filename: 'photo.png', path: 'assets/photo.png', mimeType: 'image/png',
    kind: 'image', byteLength: 1, width: 1, height: 1 }
  return { layerItemId: 'composition-original', label: '图文组合', kind: 'composition',
    frame: { mode: 'absolute', x: 40, y: 60, width: 600, height: 400 }, order: 20,
    visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    content: { assets: { 'photo.png': { assetId: 'photo' } }, root: {
      id: 'composition-root', kind: 'element', tagName: 'div', attributes: { id: 'authored-panel', style: 'display:grid;gap:24px' },
      children: [
        { id: 'composition-title', kind: 'text', text: '保留布局和内容' },
        { id: 'composition-image', kind: 'element', tagName: 'img', attributes: { src: 'photo.png' }, children: [] },
        { id: 'composition-document', kind: 'document', content: { blocks: [
          { id: 'body-list', type: 'list', ordered: false, items: [{ id: 'list-entry', content: { inlines: [{ type: 'text', text: '正文' }] } }] },
          { id: 'body-image', type: 'media', assetId: 'photo', mediaKind: 'image', layout: 'content-width' },
        ] } },
      ],
    } } }
}

function expectIndependentCopy(original: CompositionLayerItem, copy: CompositionLayerItem) {
  expect(copy.layerItemId).not.toBe(original.layerItemId)
  expect(copy.frame).toMatchObject({ x: 60, y: 80, width: 600, height: 400 })
  const originalIds = new Set<string>(), copiedIds = new Set<string>()
  walkComposition(original.content.root, node => originalIds.add(node.id))
  walkComposition(copy.content.root, node => copiedIds.add(node.id))
  expect(copiedIds.size).toBe(originalIds.size)
  expect([...copiedIds].some(id => originalIds.has(id))).toBe(false)
  expect(copy.content.assets).toEqual(original.content.assets)
  expect(copy.content.root.kind).toBe('element')
  if (copy.content.root.kind !== 'element' || original.content.root.kind !== 'element') throw new Error('element root required')
  expect(copy.content.root.attributes).toEqual(original.content.root.attributes)
  expect(copy.content.root.children[0]).toMatchObject({ kind: 'text', text: '保留布局和内容' })
  const doc = copy.content.root.children.find(node => node.kind === 'document')!
  if (doc.kind !== 'document') throw new Error('document required')
  expect(doc.content.blocks[0]!.id).not.toBe('body-list')
  const list = doc.content.blocks[0]!
  if (list.type !== 'list') throw new Error('list required')
  expect(list.items[0]!.id).not.toBe('list-entry')
  expect(doc.content.blocks[1]).toMatchObject({ type: 'media', assetId: 'photo' })
}

it('copies Slide compositions with independent child identities, shared assets and editable root geometry', () => {
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const source = composition(project), surface = project.surfaces[0]!
  if (surface.type !== 'slide') throw new Error('slide required')
  surface.scenes[0]!.layerItems.push(source)
  const clipboard = copySlideSceneClipboard({ scope: 'scene', history: { present: project },
    selection: { locationId: project.startLocationId, stateId: null } }, [source.layerItemId])
  expect(clipboard.resourceReferences).toEqual({ assetIds: ['photo'], componentPackages: [] })
  const ids = mutatePasteSlideSceneClipboard(project, { locationId: project.startLocationId, stateId: null, clipboard })
  const copy = surface.scenes[0]!.layerItems.find(item => item.layerItemId === ids[0])!
  if (copy.kind !== 'composition') throw new Error('composition required')
  expectIndependentCopy(source, copy)
  const properties = propertiesViewFromLayerItem(copy)
  expect(properties).toMatchObject({ type: 'composition', width: 600, height: 400 })
  expect(effectivePatchFromProperties(copy, { x: 120, width: 720, opacity: 0.8 })).toEqual({ frame: { x: 120, width: 720 }, opacity: 0.8 })
  expect(courseProjectDocumentSchema.safeParse(project).success).toBe(true)
})

it('duplicates Spatial compositions through the same child identity and resource rules', () => {
  const project = createBlankSpatialCourseProject({ includeDefaultController: false, controls: 'none' })
  const source = composition(project), surface = project.surfaces[0]!
  if (surface.type !== 'spatial-2d') throw new Error('spatial required')
  surface.world.layerItems.push(source)
  const result = duplicateSpatialLayers(openSpatialAuthoringSession(project), [source.layerItemId])
  expect(result.ok).toBe(true)
  const next = result.nextSession!.history.present, nextSurface = next.surfaces[0]!
  if (nextSurface.type !== 'spatial-2d') throw new Error('spatial required')
  const copy = nextSurface.world.layerItems.find(item => item.layerItemId !== source.layerItemId)!
  if (copy.kind !== 'composition') throw new Error('composition required')
  expectIndependentCopy(source, copy)
  expect(Object.keys(next.assets)).toEqual(['photo'])
  expect(courseProjectDocumentSchema.safeParse(next).success).toBe(true)
})
