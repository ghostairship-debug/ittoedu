// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { componentContentSha256 } from '../../src/shared/componentContentIntegrity'
import {
  discoverDynamicContentTargets,
  planDynamicContentEdit,
  type DynamicContentHostTarget,
  type DynamicContentObservedTarget,
} from '../../src/core/tools/DynamicContentEditPlanner'
import type { AssetMeta } from '../../src/shared/contracts/media-v1/types'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const driver = new CourseV9Driver()
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64'))
const timestamp = '2026-09-29T10:00:00.000Z'
const image = (id: string): AssetMeta => ({ id, filename: `${id}.png`, mimeType: 'image/png', kind: 'image',
  path: `assets/${id}.png`, byteLength: png.byteLength, width: 1, height: 1 })

function fixture(name: 'surface-runtime' | 'component'): DocumentSnapshot {
  const model = driver.load(new Uint8Array(readFileSync(`tests/fixtures/course-project-v9/${name}.h5lesson`)))
  if (model.kind !== 'course-v9') throw new Error('fixture must be V9')
  return { documentId: `document-${name}`, epoch: `epoch-${name}`, revision: model.project.revision,
    binding: { kind: 'untitled', suggestedName: `${name}.h5lesson` }, model, dirty: false, saving: false,
    recoverable: true, undoDepth: 0, redoDepth: 0 }
}

function target(snapshot: DocumentSnapshot, itemId: string, fieldKind: DynamicContentHostTarget['field']['kind'], observed: readonly DynamicContentObservedTarget[] = []) {
  const values = discoverDynamicContentTargets(snapshot, { target: { kind: 'course-object', locationId: 'location-scene-1', itemId }, observed })
  const found = values.find(value => value.field.kind === fieldKind)
  if (!found) throw new Error(`Missing ${fieldKind}`)
  return found
}

function item(snapshot: DocumentSnapshot, itemId: string) {
  if (snapshot.model.kind !== 'course-v9') throw new Error('course')
  const surface = snapshot.model.project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('slide')
  const found = surface.scenes[0]?.layerItems.find(value => value.layerItemId === itemId)
  if (!found) throw new Error('item')
  return found
}

function fallback(id: string) { return { asset: image(id), bytes: png } }

function reopenPlanned(snapshot: DocumentSnapshot, planned: Extract<ReturnType<typeof planDynamicContentEdit>, { status: 'planned' }>) {
  if (snapshot.model.kind !== 'course-v9') throw new Error('course')
  expect(planned.model.project.revision).toBe(snapshot.model.project.revision)
  const applied = driver.apply(snapshot.model, { type: 'course.replace', project: planned.model.project, resources: planned.model.resources })
  if (applied instanceof Promise) throw new Error('unexpected async apply')
  const committed = driver.withRevision(applied, snapshot.revision + 1)
  return driver.load(driver.serialize(committed))
}

describe('M27-T03 host discovered dynamic content planner', () => {
  it('changes real Runtime fixture text with captured fallback, then saves and reopens without rewriting source', () => {
    const snapshot = fixture('surface-runtime')
    const originalModel = structuredClone(snapshot.model)
    const before = item(snapshot, 'slide-surface-runtime')
    if (before.kind !== 'runtime') throw new Error('runtime')
    const handle = target(snapshot, before.layerItemId, 'runtime.value')
    const initial = before.runtime.content.values.title
    const pending = planDynamicContentEdit({ snapshot, target: handle, change: { kind: 'text', value: '观察后的新标题' }, now: timestamp })
    expect(pending).toMatchObject({ ok: true, status: 'needs-fallback' })
    const badCapture = planDynamicContentEdit({ snapshot, target: handle, change: { kind: 'text', value: '观察后的新标题' },
      now: timestamp, fallback: { asset: image('invalid-fallback'), bytes: new Uint8Array(png.byteLength) } })
    expect(badCapture).toMatchObject({ ok: false, code: 'invalid-resource' })
    expect(snapshot.model).toEqual(originalModel)
    const planned = planDynamicContentEdit({ snapshot, target: handle, change: { kind: 'text', value: '观察后的新标题' },
      now: timestamp, fallback: fallback('ai-text-fallback') })
    if (!planned.ok || planned.status !== 'planned') throw new Error('text planning failed')
    const reopened = driver.load(driver.serialize(reopenPlanned(snapshot, planned)))
    if (reopened.kind !== 'course-v9') throw new Error('course')
    const edited = item({ ...snapshot, model: reopened }, before.layerItemId)
    if (edited.kind !== 'runtime') throw new Error('runtime')
    expect(edited.runtime.source).toBe(before.runtime.source)
    expect(edited.runtime.content.values.title).toBe('观察后的新标题')
    expect(edited.runtime.staticFallback?.assetId).toBe('ai-text-fallback')
    expect(reopened.resources.assets['ai-text-fallback']).toEqual(png)
    expect(initial).not.toBe(edited.runtime.content.values.title)
  })

  it('replaces a real Runtime fixture image and resource in one model; stale, lock and conflict leave the source intact', () => {
    const snapshot = fixture('surface-runtime')
    const originalModel = structuredClone(snapshot.model)
    const before = item(snapshot, 'slide-surface-runtime')
    if (before.kind !== 'runtime') throw new Error('runtime')
    const handle = target(snapshot, before.layerItemId, 'runtime.image')
    const next = image('ai-hero')
    const plan = planDynamicContentEdit({ snapshot, target: handle, change: { kind: 'image', asset: next, bytes: png },
      now: timestamp, fallback: fallback('ai-image-fallback') })
    if (!plan.ok || plan.status !== 'planned') throw new Error('image planning failed')
    const reopened = reopenPlanned(snapshot, plan)
    const edited = item({ ...snapshot, model: reopened }, before.layerItemId)
    if (edited.kind !== 'runtime' || reopened.kind !== 'course-v9') throw new Error('runtime')
    expect(edited.runtime.assets.hero.assetId).toBe(next.id)
    expect(edited.runtime.staticFallback?.assetId).toBe('ai-image-fallback')
    expect(reopened.resources.assets[next.id]).toEqual(png)
    expect(reopened.resources.assets['ai-image-fallback']).toEqual(png)

    const stale = planDynamicContentEdit({ snapshot: { ...snapshot, revision: snapshot.revision + 1 }, target: handle,
      change: { kind: 'image', asset: next, bytes: png }, now: timestamp })
    expect(stale).toMatchObject({ ok: false, code: 'target-conflict' })
    const locked = structuredClone(snapshot)
    const lockedItem = item(locked, before.layerItemId)
    lockedItem.locked = true
    expect(planDynamicContentEdit({ snapshot: locked, target: handle,
      change: { kind: 'image', asset: next, bytes: png }, now: timestamp })).toMatchObject({ ok: false, code: 'target-conflict' })
    const collision = planDynamicContentEdit({ snapshot, target: handle,
      change: { kind: 'image', asset: { ...next, id: before.runtime.assets.hero.assetId }, bytes: png }, now: timestamp })
    expect(collision).toMatchObject({ ok: false, code: 'invalid-resource' })
    expect(snapshot.model).toEqual(originalModel)
  })

  it('uses a fresh M15 observed Component text hit; hidden or stale hits cannot issue handles', () => {
    const snapshot = fixture('component')
    const before = item(snapshot, 'slide-quiz')
    if (before.kind !== 'component') throw new Error('component')
    const observed: DynamicContentObservedTarget = { kind: 'component.text', source: 'auto', revision: snapshot.revision,
      locationId: 'location-scene-1', itemId: before.layerItemId, original: '请选择答案', region: 'section>h2', text: '请选择答案' }
    expect(discoverDynamicContentTargets(snapshot, { target: { kind: 'course-object', locationId: 'location-scene-1', itemId: before.layerItemId } }))
      .not.toContainEqual(expect.objectContaining({ field: expect.objectContaining({ kind: 'component.text' }) }))
    expect(discoverDynamicContentTargets(snapshot, { target: { kind: 'course-object', locationId: 'location-scene-1', itemId: before.layerItemId },
      observed: [{ ...observed, revision: snapshot.revision - 1 }] })).toEqual([])
    const handle = target(snapshot, before.layerItemId, 'component.text', [observed])
    const plan = planDynamicContentEdit({ snapshot, target: handle, change: { kind: 'text', value: '请选出正确答案' },
      now: timestamp, fallback: fallback('component-text-fallback') })
    if (!plan.ok || plan.status !== 'planned') throw new Error('component text failed')
    const reopened = reopenPlanned(snapshot, plan)
    const edited = item({ ...snapshot, model: reopened }, before.layerItemId)
    if (edited.kind !== 'component') throw new Error('component')
    expect(edited.textOverrides).toEqual([{ original: '请选择答案', region: 'section>h2', text: '请选出正确答案' }])
    expect(edited.component).toEqual(before.component)
    expect(edited.staticFallbackAssetId).toBe('component-text-fallback')
  })

  it('replaces an observed Component manifest image and preserves the embedded package on reopen', () => {
    const snapshot = fixture('component')
    if (snapshot.model.kind !== 'course-v9') throw new Error('course')
    const original = item(snapshot, 'slide-quiz')
    if (original.kind !== 'component') throw new Error('component')
    const packageKey = `${original.component.packageId}@${original.component.version}`
    const files = snapshot.model.resources.components[packageKey]!
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])) as { assets: Record<string, string> }
    manifest.assets.hero = 'hero.png'
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
    files['hero.png'] = png
    snapshot.model.project.componentPackages[original.component.packageId]!.contentSha256 = componentContentSha256(files)
    driver.validate(snapshot.model)
    const observed: DynamicContentObservedTarget = { kind: 'component.image', source: 'auto', revision: snapshot.revision,
      locationId: 'location-scene-1', itemId: original.layerItemId, assetKey: 'hero' }
    const handle = target(snapshot, original.layerItemId, 'component.image', [observed])
    const plan = planDynamicContentEdit({ snapshot, target: handle,
      change: { kind: 'image', asset: image('component-new-hero'), bytes: png }, now: timestamp,
      fallback: fallback('component-image-fallback') })
    if (!plan.ok || plan.status !== 'planned') throw new Error('component image failed')
    const reopened = reopenPlanned(snapshot, plan)
    const edited = item({ ...snapshot, model: reopened }, original.layerItemId)
    if (edited.kind !== 'component' || reopened.kind !== 'course-v9') throw new Error('component')
    expect(edited.assetOverrides?.hero?.assetId).toBe('component-new-hero')
    expect(reopened.resources.assets['component-new-hero']).toEqual(png)
    expect(reopened.resources.components[packageKey]).toEqual(files)
  })
})
