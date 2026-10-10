const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const Module = require('node:module')
const [bundle, root, directory, code, base64] = process.argv.slice(2)
const fromRoot = createRequire(path.join(root, 'package.json'))
const originalLoad = Module._load
let unavailable = true, nativeRequests = 0
const cause = Object.assign(new Error(`${code}: C:/Users/private-native-user/Temp/libvips.dll`), { code })
Module._load = function (request, parent, isMain) {
  if (request === 'sharp') {
    nativeRequests++
    if (unavailable) throw cause
    return originalLoad.call(this, fromRoot.resolve('sharp'), parent, isMain)
  }
  if (request === 'electron') return { app: { getPath: () => path.join(directory, 'diagnostics'), isReady: () => true, getVersion: () => 'test' }, dialog: {} }
  return originalLoad.call(this, request, parent, isMain)
}
async function main() {
  const product = require(bundle)
  assert.equal(nativeRequests, 0, 'The four startup entry modules must not load sharp')
  const png = Buffer.from(base64, 'base64'), store = path.join(directory, 'attachments')
  const service = new product.AttachmentService({ directory: store, extractor: { extract: async () => ({
    material: { version: 1, extractorVersion: 'fixture', format: 'pdf',
      fragments: [{ id: 'figure', kind: 'image', assetId: 'figure', locator: { part: 'page:1', page: 1 } }],
      assets: [{ id: 'figure', mime: 'image/png', bytes: Uint8Array.from(png) }], gaps: [] },
    totalPages: 1, selectedPages: { from: 1, to: 1 }, pageImages: [{ assetId: 'figure', width: 9, height: 7, downsampled: false }],
  }) } })
  const text = await service.receiveBytes({ name: 'draft.md', bytes: Buffer.from('人工原稿'), source: { kind: 'paste' } })
  const pdf = await service.receiveBytes({ name: 'source.pdf', bytes: Buffer.from('%PDF-1.7\nfixture'), source: { kind: 'paste' } })
  assert.equal(nativeRequests, 0, 'Text and original PDF storage remain available without sharp')
  let providerCalls = 0
  const probe = new product.ModelCapabilityProbe({ createId: () => 'probe-id', provider: { async *stream(request) {
    providerCalls++
    yield { type: 'response.completed', requestId: request.requestId, assistant: { role: 'assistant', content: '',
      tool_calls: [{ id: 'call', type: 'function', function: { name: 'capability_probe', arguments: JSON.stringify({ token: 'probe-id' }) } }] } }
  } } })
  assert.equal((await probe.probe({}, ['tools'])).outcomes[0].status, 'supported')
  assert.equal(nativeRequests, 0)
  async function failure(operation, attachment = false) {
    let error
    try { await operation() } catch (caught) { error = caught }
    assert.equal(error?.code, 'image-decoder-unavailable')
    const native = attachment ? error.cause : error
    assert.equal(native.name, 'ImageDecoderUnavailableError')
    assert.equal(native.cause, cause, 'The original loader error must remain available')
    const ui = product.normalizeDesktopError(attachment ? product.attachmentOperationError(error) : error,
      { code: 'GENERIC', title: '失败', message: 'generic', suggestion: 'generic' })
    assert.equal(ui.code, attachment ? 'attachment-image-decoder-unavailable' : 'image-decoder-unavailable')
    assert.match(ui.message, /本机图片处理模块/)
    assert.doesNotMatch(ui.message, /private-native-user/)
  }
  const input = { bytes: png, mimeType: 'image/png', filename: 'good.png' }
  await failure(() => product.prepareImageResource(input, () => { throw new Error('Do not allocate an image on failure') }))
  await failure(() => product.inspectImageFile(png))
  await failure(() => product.normalizeImage(png, 1600))
  await failure(() => probe.probe({}, ['vision']))
  assert.equal(providerCalls, 1, 'A failed local vision challenge must not send a model request')
  await failure(() => service.receiveBytes({ name: 'good.png', bytes: png, source: { kind: 'paste' } }), true)
  await failure(() => service.extract(pdf.id), true)
  assert.deepEqual((await fs.readdir(path.join(store, 'snapshots'))).sort(), [text.id + '.json', pdf.id + '.json'].sort())
  assert.deepEqual(await service.readSnapshot(pdf.id), pdf)
  assert.equal(Buffer.from((await service.readRepresentation(text.id, 'original-text')).bytes).toString(), '人工原稿')
  unavailable = false
  const admitted = await Promise.all([1, 2, 3].map(index => product.prepareImageResource(input, () => `image-${index}`)))
  for (const image of admitted) { assert.equal(image.meta.width, 9); assert.equal(image.meta.height, 7); assert.deepEqual(Buffer.from(image.bytes), png) }
  assert.equal(product.getImageDecoder(), product.getImageDecoder(), 'Successful loading uses Node module identity')
  assert.equal((await product.inspectImageFile(png)).width, 9)
  const rotated = await product.editImageFile(png, [{ type: 'image.rotate', degrees: 90 }])
  assert.equal(rotated.width, 7); assert.equal(rotated.height, 9)
  const normalized = await product.normalizeImage(png, 1600)
  assert.deepEqual(Buffer.from(normalized.bytes), png)
  const recovered = await service.extract(pdf.id)
  assert.equal(recovered.coverage.complete, true)
  assert.equal(recovered.gaps.length, 0)
  assert.equal(recovered.representations[0].width, 9)
  assert.deepEqual(await service.readSnapshot(pdf.id), pdf)
  const damaged = Buffer.concat([png.subarray(0, 8), Buffer.from('damaged pixels')])
  await assert.rejects(service.receiveBytes({ name: 'bad.png', bytes: damaged, source: { kind: 'paste' } }), error => error.code === 'invalid-image')
  const report = await product.diagnosticLog.report()
  assert.match(report, /"nativeModule":"sharp"/)
  assert.match(report, new RegExp(`"code":"${code}"`))
  assert.match(report, /"category":"ImageDecoderUnavailableError"/)
  assert.doesNotMatch(report, /private-native-user|libvips\.dll|人工原稿/)
  process.stdout.write(JSON.stringify({ startupLoaded: true, nonImageAvailable: true, providerCalls, recoveredImages: admitted.length,
    recoveredExtraction: recovered.coverage.complete, nativeRequests }) + '\n')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
