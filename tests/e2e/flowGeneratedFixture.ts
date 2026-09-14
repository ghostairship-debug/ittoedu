import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { createBlankFlowCourseProject } from '../../src/renderer/project/createFlowCourseProject'
import { createCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { createImageAssetImport } from '../../src/renderer/project/assetManager'
import { createSortComponentPackage } from '../../src/renderer/recipes/sort-component/package'
import { courseAuthoringScopeFromLocation, makeLayerItemAuthoringAddress } from '../../src/renderer/authoring/courseAuthoringScope'
import { carrierForFlowBlock, makeFlowBlockAuthoringAddress } from '../../src/renderer/course/flowDocumentModel'
import { executeAuthoringTool, type AuthoringToolDefinition } from '../../src/renderer/authoring/tools/executeAuthoringTool'
import { applyEditorTransactionStep, type EditorTransactionStep, type EditorTransactionState } from '../../src/renderer/authoring/editorTransaction'
import { flowAuthoringTool } from '../../src/renderer/authoring/tools/flowAuthoringTool'
import { nativeAuthoringTool } from '../../src/renderer/authoring/tools/nativeAuthoringTool'
import { componentInsertTool } from '../../src/renderer/authoring/tools/componentInsertTool'
import type { AuthoringToolDestinationV1 } from '../../src/shared/authoringToolContract'

/** New content is produced by formal tools. Existing files supply only library assets. */
export async function createGeneratedFlowFixture(root: string, directory: string, blank = false) {
  const imagePath = process.env.FLOW_REUSE_IMAGE ?? join(root, 'resources/icons/icon.png')
  const bytes = readFileSync(imagePath), image = await sharp(bytes).metadata()
  const asset = createImageAssetImport({ name: basename(imagePath), bytes, mimeType: image.format === 'webp' ? 'image/webp' : 'image/png' },
    { dimensions: { width: image.width!, height: image.height! } }).meta
  const pkg = createSortComponentPackage()
  const project = createBlankFlowCourseProject({ id: `new-flow-${Date.now()}` })
  project.assets[asset.id] = structuredClone(asset)
  project.componentPackages[pkg.manifest.id] = pkg.metadata
  let state: EditorTransactionState = { document: project, resources: { assetFiles: { [asset.id]: new Uint8Array(bytes) }, componentPackages: { [pkg.manifest.id]: pkg } } }
  const commits: EditorTransactionStep[] = [], receipts: unknown[] = []
  const port = { readDocument: () => state.document, readResources: () => state.resources, validateDestination: () => null,
    commit(step: EditorTransactionStep) { state = applyEditorTransactionStep(state, step, 'forward'); commits.push(step); return true } }
  const flow = () => state.document.surfaces.find(surface => surface.type === 'flow')!
  const scope = () => {
    const owner = courseAuthoringScopeFromLocation({ project: state.document, locationId: state.document.startLocationId })
    return { projectId: project.id, documentRevision: state.document.revision, revisionPolicy: { kind: 'exact' as const },
      sessionGeneration: 1, surfaceType: 'flow' as const, surfaceId: flow().id, locationId: state.document.startLocationId,
      stateId: null, owner: owner.owner, ownerKey: owner.ownerKey }
  }
  const create = (body = true): AuthoringToolDestinationV1 => ({ kind: 'create', scope: { ...scope(),
    parent: body ? { kind: 'flow-body', parentBlockId: null } : { kind: 'owner' }, insertion: { kind: 'append' } } })
  const update = (id: string): AuthoringToolDestinationV1 => {
    const block = flow().blocks.find(block => block.id === id)
    return { kind: 'update', target: { ...scope(), itemId: id, authoringAddress: block
      ? makeFlowBlockAuthoringAddress({ projectId: project.id, surfaceId: flow().id, blockId: id, carrier: carrierForFlowBlock(block) })
      : makeLayerItemAuthoringAddress({ projectId: project.id, surfaceId: flow().id, sceneId: null, owner: 'surface', kind: 'native', layerItemId: id }) } }
  }
  const run = async <T>(tool: AuthoringToolDefinition<T>, input: unknown, destination: AuthoringToolDestinationV1) => {
    const receipt = await executeAuthoringTool({ version: 1, requestId: `new-flow-${receipts.length}`, tool: tool.name, input, destination }, tool, port)
    receipts.push(receipt)
    if (receipt.status !== 'committed') throw new Error(JSON.stringify(receipt))
    return receipt.affected[0]!.id
  }
  const save = (name: string) => {
    const path = join(directory, `${name}.h5lesson`)
    writeFileSync(path, createCourseProjectArchive({ project: state.document, assetFiles: state.resources.assetFiles,
      componentFiles: { [`${pkg.manifest.id}@${pkg.manifest.version}`]: pkg.files } }))
    return path
  }
  if (blank) return { path: save('ai-new-flow'), surfaceId: flow().id, assetId: asset.id, packageId: pkg.manifest.id }
  await run(flowAuthoringTool, { operation: 'edit', text: '观察、解释与验证' }, update(flow().blocks[0]!.id))
  await run(flowAuthoringTool, { operation: 'edit', text: '先观察图像，再用自己的话解释现象，最后调整下面的步骤顺序。正文、配图和活动沿文档顺序排列，并随当前窗口自然重排。' }, update(flow().blocks[1]!.id))
  const shortPath = save('new-flow-short')
  await run(componentInsertTool, { operation: 'existing', packageId: pkg.manifest.id, staticFallbackAssetId: asset.id }, create())
  await run(flowAuthoringTool, { operation: 'insert', block: { type: 'media', mediaKind: 'image', assetId: asset.id,
    layout: 'content-width', caption: '观察图片中的结构，用证据说明自己的判断。', altText: '用于观察与描述的教学配图' } }, create())
  for (let index = 0; index < 10; index++) await run(flowAuthoringTool, { operation: 'insert', block: { type: 'paragraph',
    text: `观察记录 ${index + 1}：${'写出观察到的变化，区分直接看到的事实与依据事实作出的推断。'.repeat(7)}` } }, create())
  // Intentional overlays have separate semantics, fixed before any screenshot.
  const paperId = await run(nativeAuthoringTool, { operation: 'insert', template: { nativeType: 'shape', shapeType: 'rectangle',
    x: 4, y: 32, width: 6, height: 32, paperSpace: 'paper', label: '稿纸旁注标记' } }, create(false))
  const viewportId = await run(nativeAuthoringTool, { operation: 'insert', template: { nativeType: 'shape', shapeType: 'ellipse',
    x: 2, y: 10, width: 10, height: 10, paperSpace: 'viewport', label: '固定视口提示' } }, create(false))
  const path = save('new-flow-generated')
  const last = commits.at(-1)!
  const undone = applyEditorTransactionStep(state, last, 'inverse')
  const redone = applyEditorTransactionStep(undone, last, 'forward')
  if (JSON.stringify(redone.document) !== JSON.stringify(state.document)) throw new Error('Formal transaction redo changed generated content')
  writeFileSync(join(directory, 'creation-receipts.json'), JSON.stringify(receipts, null, 2))
  return { path, shortPath, surfaceId: flow().id, paperId, viewportId, assetId: asset.id, packageId: pkg.manifest.id }
}
