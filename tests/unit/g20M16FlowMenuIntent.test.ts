import { describe, expect, it, vi } from 'vitest'
import { createImageNode, createShapeNode, createTextNode } from '@/core/tools/nativeNodeFactories'
import { flowSurfaceIn } from '@/core/tools/flowDocumentModel'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { createBlankFlowCourseProject, openFlowAuthoringSession } from '@/renderer/project/createFlowCourseProject'
import { createCourseAuthoringSession } from '@/renderer/authoring/courseAuthoringSession'
import { buildFlowEditorView, captureFlowEditorAuthoringTarget } from '@/renderer/course/flowEditorView'
import { commitFlowEditorHistory } from '@/renderer/course/flowEditorSlice'
import { createFlowAuthoringSlice, type FlowAuthoringPorts } from '@/renderer/store/slices/flowAuthoringSlice'
import { emptyCourseAssetSidecar } from '@/renderer/project/v9AssetAdapter'
import type { CourseAuthoringTarget } from '@/renderer/authoring/courseAuthoringSession'
import type { FlowMenuPaperItem } from '@/core/tools/flowMenuPaperInsertion'
import type { ComponentLayerItem } from '@/shared/courseProjectTypes'
import type { EditorStoreKernel } from '@/renderer/store/editorStoreKernel'

const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
const frame = { mode: 'absolute' as const, x: 30, y: 50, width: 220, height: 120 }

function harness(prepare?: (project: ReturnType<typeof createBlankFlowCourseProject>) => void) {
  const project = createBlankFlowCourseProject({ idFactory: (() => { let n = 0; return () => `id${++n}` })() })
  prepare?.(project)
  let session = openFlowAuthoringSession(project)
  let owner = createCourseAuthoringSession({ locationId: session.selection.locationId, surfaceType: 'flow', revision: project.revision })
  let sidecar = emptyCourseAssetSidecar()
  let mode: 'edit' | 'run' = 'edit'
  const persist = vi.fn((result: Parameters<FlowAuthoringPorts['persist']>[0], extra?: Parameters<FlowAuthoringPorts['persist']>[1]) => {
    if (!result.ok) return result
    const next = result.nextDocument ?? session.history.present
    session = {
      history: result.historyEntry ? commitFlowEditorHistory(session.history, next) : { ...session.history, present: next },
      selection: extra?.selection ?? result.selection ?? session.selection,
    }
    if (extra?.sidecar) sidecar = extra.sidecar
    owner = createCourseAuthoringSession({ locationId: session.selection.locationId, surfaceType: 'flow', revision: next.revision })
    return result
  })
  const ports: FlowAuthoringPorts = {
    read: () => ({ flowSession: session, flowTextEdit: null, flowClipboard: null }),
    readAuthoringSession: () => owner,
    readAssetSidecar: () => sidecar,
    readCanvasMode: () => mode,
    patch: () => undefined,
    persist,
    applyBackend: () => undefined,
  }
  const run = createFlowAuthoringSlice({} as EditorStoreKernel, ports).runFlowAuthoringIntent
  const target = (kind: 'surface' | 'block' | 'overlay' = 'surface'): CourseAuthoringTarget => captureFlowEditorAuthoringTarget({
    view: buildFlowEditorView({ project: session.history.present, locationId: session.selection.locationId }),
    sessionToken: owner.token,
    target: kind === 'surface' ? { kind: 'surface' }
      : kind === 'block' ? { kind: 'block', blockId: flowSurfaceIn(session.history.present, session.selection.surfaceId).blocks[0]!.id }
        : { kind: 'overlay', layerItemId: flowSurfaceIn(session.history.present, session.selection.surfaceId).surfaceLayerItems[0]!.item.layerItemId },
  })
  return { run, target, persist, get session() { return session }, get sidecar() { return sidecar }, setMode(value: 'edit' | 'run') { mode = value } }
}

function paperItem(kind: 'text' | 'shape' | 'image', assetId = 'unused'): FlowMenuPaperItem {
  const node = kind === 'text' ? createTextNode({ id: `menu-${kind}`, text: '文字' })
    : kind === 'shape' ? createShapeNode('rectangle', { id: `menu-${kind}` })
      : createImageNode({ id: `menu-${kind}`, name: '图片', assetId, width: 64, height: 64 })
  return sceneNodeToCourseLayerItem(node) as FlowMenuPaperItem
}

describe('Flow menu authoring intent', () => {
  it.each(['heading', 'list', 'table', 'formula', 'divider', 'callout', 'section'] as const)('commits %s through one history entry', documentKind => {
    const h = harness(); const before = h.session.history.present
    const receipt = h.run(h.target('block'), { kind: 'menu-insert-document', documentKind })
    expect(receipt.ok, receipt.reason).toBe(true)
    expect(h.session.history.present.revision).toBe(before.revision + 1)
    expect(h.session.history.past).toHaveLength(1)
    expect(h.persist).toHaveBeenCalledTimes(1)
    expect(h.session.selection.selectedBlockId).toBeTruthy()
  })

  it('rejects stale, global and read only menu operations before persist', () => {
    const h = harness(); const stale = h.target()
    expect(h.run(h.target(), { kind: 'menu-insert-document', documentKind: 'divider' }).ok).toBe(true)
    expect(h.run(stale, { kind: 'menu-insert-document', documentKind: 'divider' }).ok).toBe(false)
    const global = { ...h.target(), owner: 'global' as const }
    expect(h.run(global, { kind: 'menu-insert-document', documentKind: 'divider' }).ok).toBe(false)
    h.setMode('run')
    expect(h.run(h.target(), { kind: 'menu-insert-document', documentKind: 'divider' }).ok).toBe(false)
    expect(h.persist).toHaveBeenCalledTimes(1)
  })

  it('inserts paper text and shape with caller frame and anchor', () => {
    const h = harness(); const blockId = flowSurfaceIn(h.session.history.present, h.session.selection.surfaceId).blocks[0]!.id
    for (const kind of ['text', 'shape'] as const) {
      const receipt = h.run(h.target(), { kind: 'menu-insert-paper', item: paperItem(kind), frame,
        paragraphAnchor: { blockId, offsetY: 8, xRatio: 0.4 } })
      expect(receipt.ok, receipt.reason).toBe(true)
    }
    const entries = flowSurfaceIn(h.session.history.present, h.session.selection.surfaceId).surfaceLayerItems
    expect(entries).toHaveLength(2)
    expect(entries.map(entry => entry.paragraphAnchor?.blockId)).toEqual([blockId, blockId])
    expect(entries.every(entry => entry.item.paperSpace === 'paper')).toBe(true)
    expect(h.session.history.past).toHaveLength(2)
  })

  it('inserts a prepared component and rejects an external paragraph anchor', () => {
    const h = harness(project => { project.componentPackages.card = {
      packageId: 'card', version: '1.0.0', name: '卡片', manifestPath: 'packages/card/manifest.json',
      runtimePath: 'packages/card/runtime.js', contentSha256: 'a'.repeat(64),
    } })
    const item: ComponentLayerItem = {
      kind: 'component', layerItemId: 'menu-component', label: '卡片', frame, order: 1, visible: true, locked: false,
      rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
      component: { packageId: 'card', version: '1.0.0' }, props: {},
    }
    const anchor = { blockId: flowSurfaceIn(h.session.history.present, h.session.selection.surfaceId).blocks[0]!.id, offsetY: 0, xRatio: 0.5 }
    expect(h.run(h.target(), { kind: 'menu-insert-paper', item, frame, paragraphAnchor: { ...anchor, blockId: 'external' } }).ok).toBe(false)
    expect(h.persist).toHaveBeenCalledTimes(0)
    const receipt = h.run(h.target(), { kind: 'menu-insert-paper', item, frame, paragraphAnchor: anchor })
    expect(receipt.ok, receipt.reason).toBe(true)
    expect(flowSurfaceIn(h.session.history.present, h.session.selection.surfaceId).surfaceLayerItems[0]?.item.kind).toBe('component')
    expect(h.persist).toHaveBeenCalledTimes(1)
  })

  it('commits new body image and sidecar in one candidate and one persist', () => {
    const h = harness(); const before = h.session.history.present
    const receipt = h.run(h.target(), { kind: 'menu-insert-media', placement: 'document', mediaKind: 'image',
      source: { kind: 'new', name: 'photo.png', mimeType: 'image/png', bytes, width: 64, height: 64 } })
    expect(receipt.ok, receipt.reason).toBe(true)
    const next = h.session.history.present
    const block = flowSurfaceIn(next, h.session.selection.surfaceId).blocks.find(entry => entry.type === 'media')
    expect(block?.type).toBe('media')
    if (!block || block.type !== 'media' || !block.assetId) throw new Error('missing media')
    expect(next.assets[block.assetId]?.kind).toBe('image')
    expect(Array.from(h.sidecar.files[block.assetId]!)).toEqual(Array.from(bytes))
    expect(before.assets[block.assetId]).toBeUndefined()
    expect(next.revision).toBe(before.revision + 1)
    expect(h.session.history.past).toHaveLength(1)
    expect(h.persist).toHaveBeenCalledTimes(1)
  })

  it('places a new paper image in the same asset transaction', () => {
    const h = harness(); const blockId = flowSurfaceIn(h.session.history.present, h.session.selection.surfaceId).blocks[0]!.id
    const receipt = h.run(h.target(), { kind: 'menu-insert-media', placement: 'paper', mediaKind: 'image',
      source: { kind: 'new', name: 'photo.png', mimeType: 'image/png', bytes, width: 64, height: 64 },
      item: paperItem('image'), frame, paragraphAnchor: { blockId, offsetY: 0, xRatio: 0.5 } })
    expect(receipt.ok, receipt.reason).toBe(true)
    const next = h.session.history.present
    const entry = flowSurfaceIn(next, h.session.selection.surfaceId).surfaceLayerItems[0]!
    expect(entry.item.kind).toBe('native')
    if (entry.item.kind !== 'native' || entry.item.content.nativeType !== 'image') throw new Error('missing paper image')
    expect(next.assets[entry.item.content.data.assetId]?.kind).toBe('image')
    expect(h.sidecar.files[entry.item.content.data.assetId]).toBeDefined()
    expect(h.session.history.past).toHaveLength(1)
    expect(h.persist).toHaveBeenCalledTimes(1)
  })

  it('replaces a paper image with one asset transaction while preserving placement and crop', () => {
    const h = harness(project => { project.assets.original = {
      id: 'original', filename: 'original.png', mimeType: 'image/png', kind: 'image', path: 'assets/original.png',
      byteLength: bytes.length, width: 64, height: 64,
    } })
    const blockId = flowSurfaceIn(h.session.history.present, h.session.selection.surfaceId).blocks[0]!.id
    const image = sceneNodeToCourseLayerItem(createImageNode({ id: 'paper-image', name: '图片', assetId: 'original',
      width: 64, height: 64, crop: { left: 0.1, top: 0.2, right: 0.15, bottom: 0.05 }, cropX: 0.6, cropY: 0.4 })) as FlowMenuPaperItem
    const anchor = { blockId, offsetY: 12, xRatio: 0.35 }
    expect(h.run(h.target(), { kind: 'menu-insert-paper', item: image, frame, paragraphAnchor: anchor }).ok).toBe(true)
    const before = h.session.history.present
    const original = flowSurfaceIn(before, h.session.selection.surfaceId).surfaceLayerItems[0]!
    const target = h.target('overlay')
    const newBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
    const receipt = h.run(target, { kind: 'import-replacement-media', name: 'replacement.png', mimeType: 'image/png', bytes: newBytes })
    expect(receipt.ok, receipt.reason).toBe(true)
    const next = h.session.history.present
    const replaced = flowSurfaceIn(next, h.session.selection.surfaceId).surfaceLayerItems[0]!
    expect(replaced.item.kind).toBe('native')
    if (replaced.item.kind !== 'native' || replaced.item.content.nativeType !== 'image'
      || original.item.kind !== 'native' || original.item.content.nativeType !== 'image') throw new Error('missing paper image')
    const assetId = replaced.item.content.data.assetId
    expect(assetId).not.toBe('original')
    expect(next.assets[assetId]).toMatchObject({ id: assetId, kind: 'image', filename: 'replacement.png', byteLength: newBytes.length })
    expect(Array.from(h.sidecar.files[assetId]!)).toEqual(Array.from(newBytes))
    expect(before.assets[assetId]).toBeUndefined()
    expect(next.revision).toBe(before.revision + 1)
    expect(replaced.paragraphAnchor).toEqual(anchor)
    expect(replaced.item.frame).toEqual(original.item.frame)
    expect(replaced.item.content.data.crop).toEqual(original.item.content.data.crop)
    expect(replaced.item.content.data.cropX).toBe(original.item.content.data.cropX)
    expect(replaced.item.content.data.cropY).toBe(original.item.content.data.cropY)
    expect(h.session.history.past).toHaveLength(2)
    expect(h.persist).toHaveBeenCalledTimes(2)

    const sidecar = h.sidecar
    const stale = h.run(target, { kind: 'import-replacement-media', name: 'stale.png', mimeType: 'image/png', bytes: newBytes })
    expect(stale.ok).toBe(false)
    expect(h.session.history.present).toBe(next)
    expect(h.sidecar).toBe(sidecar)
    expect(h.persist).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['video', 'video/mp4', 'clip.mp4'],
    ['audio', 'audio/mpeg', 'sound.mp3'],
  ] as const)('commits a new %s asset with its body block once', (mediaKind, mimeType, name) => {
    const h = harness()
    const receipt = h.run(h.target(), { kind: 'menu-insert-media', placement: 'document', mediaKind,
      source: { kind: 'new', name, mimeType, bytes: Uint8Array.from([1, 2, 3]), duration: 3 } })
    expect(receipt.ok, receipt.reason).toBe(true)
    const block = flowSurfaceIn(h.session.history.present, h.session.selection.surfaceId).blocks.find(entry => entry.type === 'media')
    if (!block || block.type !== 'media' || !block.assetId) throw new Error('missing media')
    expect(block.mediaKind).toBe(mediaKind)
    expect(h.session.history.present.assets[block.assetId]?.kind).toBe(mediaKind)
    expect(h.sidecar.files[block.assetId]).toBeDefined()
    expect(h.session.history.past).toHaveLength(1)
    expect(h.persist).toHaveBeenCalledTimes(1)
  })

  it('uses an existing asset without a sidecar write and rejects mismatches', () => {
    const h = harness(project => { project.assets.existing = {
      id: 'existing', filename: 'photo.png', mimeType: 'image/png', kind: 'image', path: 'assets/existing.png',
      byteLength: bytes.length, width: 64, height: 64,
    } })
    expect(h.run(h.target(), { kind: 'menu-insert-media', placement: 'document', mediaKind: 'video',
      source: { kind: 'existing', assetId: 'existing' } }).ok).toBe(false)
    expect(h.persist).toHaveBeenCalledTimes(0)
    const receipt = h.run(h.target(), { kind: 'menu-insert-media', placement: 'document', mediaKind: 'image',
      source: { kind: 'existing', assetId: 'existing' } })
    expect(receipt.ok, receipt.reason).toBe(true)
    expect(h.sidecar.files.existing).toBeUndefined()
    expect(h.persist).toHaveBeenCalledTimes(1)
  })

  it('uses prepared metadata and rejects duplicate prepared IDs', () => {
    const h = harness()
    const meta = { id: 'prepared-image', filename: 'ready.png', mimeType: 'image/png', kind: 'image' as const,
      path: 'assets/prepared-image.png', byteLength: bytes.length, width: 64, height: 64 }
    const source = { kind: 'new' as const, meta, bytes }
    const receipt = h.run(h.target(), { kind: 'menu-insert-media', placement: 'document', mediaKind: 'image', source })
    expect(receipt.ok, receipt.reason).toBe(true)
    expect(h.session.history.present.assets[meta.id]).toEqual(meta)
    expect(h.sidecar.files[meta.id]).toBeDefined()
    expect(h.run(h.target(), { kind: 'menu-insert-media', placement: 'document', mediaKind: 'image', source }).ok).toBe(false)
    expect(h.persist).toHaveBeenCalledTimes(1)
  })
})
