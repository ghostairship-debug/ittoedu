/** Prepare a separate original-work authoring pilot through the formal writer.
 * This helper neither invokes a model nor modifies the accepted Oasis 04 archive.
 */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { build } from 'esbuild'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { OASIS_04_SHA256, repairOasisAuthorHandoff } from '../fixtures/creation/repairOasisAuthorHandoff'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

export const oasisDigest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export const oasisCourse = (snapshot: DocumentSnapshot) => {
  assert(snapshot.model.kind === 'course-v10'); return snapshot.model
}
export function oasisModules(model: ReturnType<typeof oasisCourse>, rootId: string): Record<string, string> {
  const data = model.project.instances[rootId]!.data
  assert(data && typeof data === 'object' && !Array.isArray(data))
  const modules = data.modules
  assert(modules && typeof modules === 'object' && !Array.isArray(modules)
    && Object.values(modules).every(value => typeof value === 'string'))
  return modules as Record<string, string>
}
export function oasisResourceDigests(model: ReturnType<typeof oasisCourse>) {
  return {
    assets: Object.fromEntries(Object.entries(model.resources.assets).map(([id, bytes]) => [id, { bytes: bytes.byteLength, sha256: oasisDigest(bytes) }])),
    components: Object.fromEntries(Object.entries(model.resources.components).map(([id, files]) => [id,
      Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, { bytes: bytes.byteLength, sha256: oasisDigest(bytes) }]))])),
  }
}

export async function prepareOasisAuthorHandoff(input: { original: string; out: string }) {
  assert(path.isAbsolute(input.original) && path.isAbsolute(input.out))
  const originalHash = oasisDigest(await fs.readFile(input.original))
  assert.equal(originalHash, OASIS_04_SHA256, 'Use the accepted Oasis 04 archive; never silently migrate a different baseline')
  const workspace = path.join(input.out, 'workspace'), media = path.join(input.out, 'existing-media')
  await fs.mkdir(workspace, { recursive: true }); await fs.mkdir(media, { recursive: true })
  const host = new DocumentHostService(path.join(input.out, 'preparation-recovery'))
  const original = await host.internalAPI.open(input.original), copy = structuredClone(oasisCourse(original))
  assert.equal(copy.project.rootIds.length, 1); assert.equal(Object.keys(copy.project.instances).length, 1)
  const originalProjectId = copy.project.id, rootId = copy.project.rootIds[0]!
  assert.equal(copy.project.entry?.rootInstanceId, rootId)
  assert.equal(copy.project.instances[rootId]!.authoring, undefined, 'The 04 baseline unexpectedly contains prior author edits')
  copy.project.id = randomUUID(); copy.project.title = '无光绿洲：深海失联 · 原作人工接手试点'
  const beforeModules = oasisModules(copy, rootId), beforeIntro = beforeModules['intro.js']!
  assert.equal(Object.keys(beforeModules).length, 8)
  const intro = repairOasisAuthorHandoff(beforeIntro)
  await build({ stdin: { contents: intro, sourcefile: 'intro.js' }, write: false, format: 'esm', bundle: false, logLevel: 'silent' })
  await fs.writeFile(path.join(input.out, 'intro-authoring-pilot.js'), intro)
  const document = await host.internalAPI.create(copy, 'oasis-human-handoff.glx')
  const runId = `oasis-authoring-prepare-${randomUUID()}`
  await host.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: document.documentId, writable: [{ kind: 'document' }] }],
    fileAccess: { workspaceRoot: input.out, permission: 'workspace' } })
  try {
    const file = componentProjectFiles(copy.project, copy.resources).find(value => value.webModule?.path === 'intro.js'
      && value.target?.kind === 'instance' && value.target.instanceId === rootId)
    assert(file, 'The formal original-work module projection is missing')
    assert.equal((await host.tools.execute(runId, 'read-intro', { name: 'project.read', input: { path: file.path } })).kind, 'read')
    const receipt = await host.tools.execute(runId, 'make-first-act-image-editable', { name: 'project.apply', input: { path: file.path, content: intro } })
    assert(receipt.kind === 'read' && (receipt.data as { commit?: string }).commit === 'committed', JSON.stringify(receipt))
    const current = await host.internalAPI.read(document.documentId), final = oasisCourse(current), expected = structuredClone(copy)
    expected.project.revision = final.project.revision; oasisModules(expected, rootId)['intro.js'] = intro
    assert.deepEqual(final, expected, 'A field outside the first-act image authoring boundary changed')
    assert.equal(current.undoDepth, 1)
    const data = final.project.instances[rootId]!.data as { resourceBindings: Record<string, string> }
    const replacementReference = 'cw-resource:939da7ad1be21ea60646b817f4165d3f783bf72d424f3b47d8ae538c43dadaa0'
    const replacementAssetId = data.resourceBindings[replacementReference]
    assert(replacementAssetId && final.project.assets[replacementAssetId])
    const replacementMeta = final.project.assets[replacementAssetId]!, bytes = final.resources.assets[replacementAssetId]!
    assert(bytes && replacementMeta.mimeType?.startsWith('image/'))
    assert.equal(oasisDigest(bytes), replacementReference.slice('cw-resource:'.length), 'The chosen picture must be the original descent asset')
    const extension = replacementMeta.mimeType === 'image/jpeg' ? '.jpg' : replacementMeta.mimeType === 'image/webp' ? '.webp' : '.png'
    const replacementFile = path.join(media, `原作已有配图-下潜${extension}`)
    await fs.writeFile(replacementFile, bytes)
    const filename = path.join(workspace, 'oasis-human-handoff.glx')
    await host.internalAPI.save(document.documentId, filename)
    const baseline = { project: final.project, resources: oasisResourceDigests(final), revision: current.revision, undoDepth: current.undoDepth }
    await fs.writeFile(path.join(input.out, 'prepared-author-baseline.json'), JSON.stringify(baseline, null, 2))
    assert.equal(oasisDigest(await fs.readFile(input.original)), originalHash)
    const facts = { status: 'prepared-for-real-app', modelRequests: 0, original: input.original, originalHash, originalUnchanged: true,
      originalProjectId, projectId: final.project.id, rootId, rootCount: 1, instanceCount: 1, workspace, glx: filename,
      glxHash: oasisDigest(await fs.readFile(filename)), modulePath: file.path, introBeforeHash: oasisDigest(beforeIntro), introAfterHash: oasisDigest(intro),
      otherSevenModulesUnchanged: true, originalResourcesUnchanged: true, logicalHistoryEntries: 1,
      replacementFile, replacementAssetId, replacementSha256: oasisDigest(bytes), replacementMimeType: replacementMeta.mimeType,
      authoring: 'ordinary DOM text, image and local geometry; no author override has been fabricated',
      visual: 'same original assets, cover and scene opacity; original two gradients paint on the image through a local SVG filter',
      imageControls: 'the current internal-image panel offers replace; geometry remains in the selection overlay, no crop control is claimed',
      runtimeValidation: 'pending complete built-App consumer' }
    await fs.writeFile(path.join(input.out, 'handoff-preparation.json'), JSON.stringify(facts, null, 2))
    await host.operate({ type: 'close', documentId: document.documentId, discardDirty: false })
    await host.operate({ type: 'close', documentId: original.documentId, discardDirty: false })
    return facts
  } finally { await host.tools.stop(runId) }
}
