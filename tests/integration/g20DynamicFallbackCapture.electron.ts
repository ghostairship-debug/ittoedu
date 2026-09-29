/** Real isolated Electron carrier for M27-T03. Run against a built renderer URL. */
import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { DynamicContentFallbackCaptureService } from '../../src/main/workbench/observation/DynamicContentFallbackCaptureService'
import { registerPrivilegedSchemes } from '../../src/main/protocols'

registerPrivilegedSchemes()
app.disableHardwareAcceleration()
app.on('window-all-closed', () => { /* The isolated capture window is expected to close. */ })

void app.whenReady().then(async () => {
  const rendererEntryUrl = process.argv[2]
  if (!rendererEntryUrl) throw new Error('Pass the built renderer index URL')
  const driver = new CourseV9Driver()
  const model = driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/surface-runtime.h5lesson')))
  if (model.kind !== 'course-v9') throw new Error('Runtime fixture missing')
  const surface = model.project.surfaces.find(value => value.type === 'slide')
  if (!surface || surface.type !== 'slide') throw new Error('Runtime slide missing')
  const runtime = surface.scenes[0]?.layerItems.find(value => value.kind === 'runtime')
  if (!runtime || runtime.kind !== 'runtime') throw new Error('Runtime layer missing')
  runtime.runtime.source = `CoursewareRuntime.define({runtimeApiVersion:3,protocol:'surface-runtime',create(ctx){
    var box=ctx.dom.root.ownerDocument.createElement('div');
    box.style.cssText='width:100%;height:100%;box-sizing:border-box;background:white;color:#ae1233;font:64px Arial;padding:30px';
    box.textContent=ctx.content.get('title');ctx.dom.root.appendChild(box);
    return {destroy(){ctx.dom.root.replaceChildren()}};
  }});`
  driver.validate(model)
  let serial = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `fallback-electron-${++serial}`,
    bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('save unused') } } })
  const document = await registry.create(model, 'fallback-electron.h5lesson')
  const fallback = new DynamicContentFallbackCaptureService({ rendererEntryUrl: () => rendererEntryUrl })
  const gateway = new DocumentToolGateway(registry, [driver], () => String(++serial), { dynamicContentFallback: fallback })
  await gateway.beginRun({ runId: 'real-fallback', actor: 'agent',
    documents: [{ documentId: document.documentId, writable: [{ kind: 'document' }] }] })
  try {
    await gateway.loadToolFamilies('real-fallback', ['content'])
    const location = model.project.locations.find(value => value.kind === 'slide-scene' && value.sceneId === surface.scenes[0]?.id)
    if (!location) throw new Error('Runtime location missing')
    const object = await gateway.issueTarget('real-fallback', document.documentId,
      { kind: 'course-object', locationId: location.id, itemId: runtime.layerItemId })
    const discovered = await gateway.execute('real-fallback', 'discover', { name: 'content.targets', input: { target: object } })
    if (discovered.kind !== 'read') throw new Error(JSON.stringify(discovered))
    const title = (discovered.data as { targets: { target: string; kind: string; text?: string }[] }).targets
      .find(value => value.kind === 'text' && value.text === '动态标题')
    if (!title) throw new Error('Runtime title target missing')
    const before = document.read()
    if (before.model.kind !== 'course-v9') throw new Error('Runtime model missing')
    const baselineTarget = { documentId: before.documentId, epoch: before.epoch, revision: before.revision,
      projectId: before.model.project.id, locationId: location.id, surfaceId: surface.id, stateId: null,
      owner: 'scene' as const, itemId: runtime.layerItemId,
      field: { kind: 'runtime.value' as const, key: 'title', expectedText: '动态标题' } }
    const baseline = await fallback.capture({ runId: 'real-fallback', documentId: document.documentId,
      target: baselineTarget, candidate: before.model })
    const changed = await gateway.execute('real-fallback', 'change-title',
      { name: 'content.update', input: { target: title.target, text: '候选截图已更新' } })
    assert.equal(changed.kind, 'document-operation', JSON.stringify(changed))
    if (changed.kind !== 'document-operation') throw new Error('ACK missing')
    assert.equal(changed.result.status, 'applied')
    const after = document.read()
    assert.equal(after.revision, before.revision + 1)
    assert.equal(after.undoDepth, before.undoDepth + 1)
    if (after.model.kind !== 'course-v9') throw new Error('Result model missing')
    const saved = driver.load(driver.serialize(after.model))
    if (saved.kind !== 'course-v9') throw new Error('Reopen failed')
    const reopened = saved.project.surfaces.find(value => value.id === surface.id)
    if (!reopened || reopened.type !== 'slide') throw new Error('Reopened slide missing')
    const edited = reopened.scenes[0]?.layerItems.find(value => value.layerItemId === runtime.layerItemId)
    if (!edited || edited.kind !== 'runtime') throw new Error('Reopened runtime missing')
    assert.equal(edited.runtime.content.values.title, '候选截图已更新')
    assert.equal(edited.runtime.source, runtime.runtime.source)
    const captureId = edited.runtime.staticFallback?.assetId
    if (!captureId || captureId === runtime.runtime.staticFallback?.assetId) throw new Error('New fallback missing')
    const captured = saved.resources.assets[captureId]
    if (!captured) throw new Error('Saved fallback bytes missing')
    const dimensions = await sharp(captured).metadata()
    assert.equal(dimensions.format, 'png')
    assert.ok(dimensions.width! > 0 && dimensions.height! > 0 && dimensions.width! < 1280 && dimensions.height! < 720)
    const originalPixels = await sharp(baseline.bytes).raw().toBuffer()
    const changedPixels = await sharp(captured).raw().toBuffer()
    assert.notDeepEqual(originalPixels, changedPixels)
    console.log(`PASS: Published layer PNG ${dimensions.width}x${dimensions.height}, candidate pixels changed, one ACK/Undo, V9 reopen`)
  } finally {
    await gateway.stop('real-fallback')
    assert.equal(BrowserWindow.getAllWindows().length, 0)
  }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1) })
