import { readImageDimensions } from '../../src/renderer/project/assetManager'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { executeAuthoringTool } from '../../src/renderer/authoring/tools/executeAuthoringTool'
import { mediaAssetTool } from '../../src/renderer/authoring/tools/mediaAssetTool'
import { validateDynamicCandidateFallbackAssets } from '../../src/renderer/authoring/tools/dynamicCandidateFallbackAssets'
import type { RuntimeLayerItem } from '../../src/shared/courseProjectTypes'

export async function run(badBase64: string) {
  const bad = Uint8Array.from(atob(badBase64), c => c.charCodeAt(0))
  const image = new Image(), url = URL.createObjectURL(new Blob([bad], { type: 'image/png' }))
  image.src = url
  await image.decode()
  const permissiveDimensions = { width: image.naturalWidth, height: image.naturalHeight }
  URL.revokeObjectURL(url)
  let badError = ''
  try { await readImageDimensions(bad, 'image/png') } catch (error) { badError = String(error) }
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces[0]!
  if (surface.type !== 'slide') throw new Error('Expected Slide')
  let commits = 0
  const beforeRevision = project.revision
  const receipt = await executeAuthoringTool({ version: 1, requestId: 'real-bad-png', tool: 'asset.media.import',
    destination: { kind: 'create', scope: { projectId: project.id, documentRevision: project.revision, revisionPolicy: { kind: 'exact' },
      sessionGeneration: 0, surfaceType: 'slide', surfaceId: surface.id, locationId: project.startLocationId, stateId: null,
      owner: 'global', ownerKey: 'global', parent: { kind: 'owner' }, insertion: { kind: 'append' } } },
    input: { kind: 'image', filename: 'malformed-pixel-data.png', mimeType: 'image/png', base64: badBase64 } }, mediaAssetTool,
  { readDocument: () => project, validateDestination: () => null, commit: () => { commits++; return true } })
  const importResult = { status: receipt.status, diagnostics: receipt.diagnostics, commits, beforeRevision,
    afterRevision: project.revision, assetsAfter: Object.keys(project.assets).length }
  project.assets.bad = { id: 'bad', kind: 'image', filename: 'bad.png', path: 'assets/bad.png', mimeType: 'image/png', byteLength: bad.length }
  const runtime: RuntimeLayerItem = { kind: 'runtime', layerItemId: 'bad-runtime', label: '坏后备图', order: 0,
    frame: { mode: 'absolute', x: 0, y: 0, width: 220, height: 220 }, visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    runtime: { protocol: 'canvas-runtime', runtimeApiVersion: 2, enabled: true, renderMode: 'dom',
      source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}})', content: { values: {} }, assets: {},
      staticFallback: { assetId: 'bad', coverage: 'scene' } } }
  surface.scenes[0]!.layerItems.push(runtime)
  let fallbackError = ''
  try { await validateDynamicCandidateFallbackAssets(project, { assetFiles: { bad }, componentPackages: {} }, ['bad-runtime']) }
  catch (error) { fallbackError = String(error) }
  const canvas = document.createElement('canvas')
  canvas.width = 4; canvas.height = 4
  canvas.getContext('2d')!.fillRect(0, 0, 4, 4)
  const valid: Array<{ name: string; mimeType: string; bytes: Uint8Array }> = []
  for (const mimeType of ['image/png', 'image/jpeg', 'image/webp']) {
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Cannot encode fixture')), mimeType))
    valid.push({ name: mimeType, mimeType, bytes: new Uint8Array(await blob.arrayBuffer()) })
  }
  valid.push({ name: 'image/gif', mimeType: 'image/gif', bytes: Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0)) })
  for (const [name, dimensions] of [['svg-explicit', 'width="4" height="4"'], ['svg-viewbox', 'viewBox="0 0 4 4"']]) {
    valid.push({ name: name!, mimeType: 'image/svg+xml', bytes: new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" ${dimensions}><rect width="4" height="4" fill="red"/></svg>`) })
  }
  const accepted = []
  for (const item of valid) accepted.push({ name: item.name, ...await readImageDimensions(item.bytes, item.mimeType) })
  return { badBytes: bad.length, permissiveDimensions, badError, importResult, fallbackError, accepted }
}
