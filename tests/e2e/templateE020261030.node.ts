/** Opt-in, no-model consumer of the existing remix/History/save/export owners. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { DocumentDeliveryService } from '../../src/main/workbench/delivery/DocumentDeliveryService'
import { DocumentDeliveryOperationStore } from '../../src/main/workbench/delivery/DocumentDeliveryOperationStore'
import { resolveSaveDestination, resolveExportDestination, workbenchExportWriter } from '../../src/main/workbench/workbenchDeliveryAdapters'
import { inspectCourseRemixSlots } from '../../src/core/course/courseProductivityEdits'
import { componentDefinitionBuiltinKey, componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { committedFact } from '../../src/core/tools/modelToolResult'
import type { DocumentSnapshot, DocumentResources } from '../../src/shared/workbench/document'
import type { ModelToolCall } from '../../src/shared/workbench/tools'

const root = resolve(__dirname, '../..')
const output = resolve(root, 'output/ai-productivity-execution-20261030/template-e0')
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
function course(snapshot: DocumentSnapshot) {
  assert.equal(snapshot.model.kind, 'course-v10')
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected course-v10')
  return snapshot.model
}
function resourceHashes(resources: DocumentResources) {
  return {
    assets: Object.fromEntries(Object.entries(resources.assets).map(([id, bytes]) => [id, digest(bytes)])),
    components: Object.fromEntries(Object.entries(resources.components).map(([id, files]) => [id,
      Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, digest(bytes)]))])),
  }
}
function assertOriginalResources(before: DocumentResources, after: DocumentResources) {
  const prior = resourceHashes(before), next = resourceHashes(after)
  for (const [id, hash] of Object.entries(prior.assets)) assert.equal(next.assets[id], hash)
  for (const [id, files] of Object.entries(prior.components)) assert.deepEqual(next.components[id], files)
}
function withoutRevision<T extends { revision: number }>(project: T) {
  const { revision: _revision, ...content } = project
  return content
}
async function json(path: string, value: unknown) {
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, JSON.stringify(value, null, 2), 'utf8')
}

/** Install the production save owner, retaining its operation journal and path authorization.
 *  Node has no renderer drafts or export worker; real compiled HTML is verified in the browser stage.
 */
function installSaveOwner(host: DocumentHostService, directory: string) {
  const deliveries = new DocumentDeliveryService({
    documents: {
      read: documentId => host.registry.get(documentId).drain(),
      saveWithFact: (documentId, filename, identity) => host.saveWithFact(documentId, filename, identity),
      lookupSave: (documentId, identity) => host.lookupSave(documentId, identity),
      withFileLease: (documentId, work) => host.registry.get(documentId).withFileLease(lease => work(() => lease.read())),
    },
    operations: new DocumentDeliveryOperationStore(join(directory, 'delivery-operations')),
    authorize: async ({ runId }) => {
      const access = host.tools.runFileAccess(runId)
      if (!access || access.permission === 'read-only') throw new Error('E0 delivery has no writable task grant')
    },
    resolveSaveDestination: ({ runId, snapshot, requested }) => resolveSaveDestination(runId, snapshot, requested, id => host.tools.runFileAccess(id)),
    resolveExportDestination: ({ runId, snapshot, requested, format, suggestedName }) =>
      resolveExportDestination(runId, snapshot, requested, suggestedName, format, id => host.tools.runFileAccess(id)),
    build: { build: async () => { throw new Error('Node E0 does not supply an export renderer; use the real browser verification stage') } },
    writer: workbenchExportWriter,
    withFileOperation: work => host.fileCoordinator.withFileOperation(work),
  })
  host.tools.configureHostServices({ deliveries })
}

export async function runTemplateE0() {
  const source = resolve(process.env.GUOLING_TEMPLATE_E0_SOURCE || join(root,
    'output/creation-editing-completion-20261029/production/workspace/repeat-market-current-manual-T3.glx'))
  const sourceBytes = await fs.readFile(source), sourceSha256 = digest(sourceBytes)
  await fs.mkdir(output, { recursive: true })
  const directory = await fs.mkdtemp(join(output, 'run-'))
  const workspace = join(directory, 'workspace')
  await fs.mkdir(workspace)
  const facts: any = { status: 'running', phase: 'formal-consumer', startedAt: new Date().toISOString(),
    source, sourceSha256, directory, modelRequests: 0, modelProviderConstructed: false,
    scope: 'Two observed native text slots (title and body) in an isolated copy; not a general template or speed benchmark.', cases: [] }
  const calls: unknown[] = []
  const active: Array<{ host: DocumentHostService; runId: string }> = []
  try {
    for (const variant of ['normal', 'overflow'] as const) {
      const file = join(workspace, `template-${variant}.glx`)
      await fs.copyFile(source, file)
      const host = new DocumentHostService(join(directory, `${variant}-documents`))
      installSaveOwner(host, join(directory, variant))
      const initial = await host.open(file), baseline = course(initial), runId = `template-e0-${variant}-${randomUUID()}`
      active.push({ host, runId })
      await host.tools.beginRun({ runId, actor: 'agent',
        documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }],
        fileAccess: { workspaceRoot: workspace, permission: 'workspace' } })
      const call = async (name: string, input: unknown) => {
        const operationId = randomUUID(), startedAt = new Date().toISOString()
        const result = await host.tools.execute(runId, operationId, { name, input } as ModelToolCall)
        calls.push({ variant, operationId, name, input, startedAt, endedAt: new Date().toISOString(), result })
        await json(join(directory, 'calls.json'), calls)
        if (result.kind === 'error') throw new Error(`${name}: ${JSON.stringify(result)}`)
        return result
      }
      const observed = componentSurfaces(baseline.project).flatMap(surface => inspectCourseRemixSlots(baseline.project, surface.id).slots
        .filter(slot => componentDefinitionBuiltinKey(baseline.project.definitions[baseline.project.instances[slot.instanceId]!.definitionId]) === 'guoling.text')
        .map(slot => ({ surface, slot })))
      await json(join(directory, `${variant}-available-slots.json`), observed.map(({ surface, slot }) => ({ surfaceId: surface.id, ...slot })))
      const selected = observed.find(({ slot }) => slot.original.includes('市集') && slot.original.trim().length <= 40)
      assert.ok(selected, 'No short formal 市集 title slot was found; inspect available-slots.json rather than guessing a target.')
      const { surface, slot } = selected, originalInstance = baseline.project.instances[slot.instanceId]!
      assert.ok(originalInstance.frame, 'The selected fixed-layout slot needs a real frame for the bounded fit probe.')
      const selectedBody = observed.filter(item => item.surface.id === surface.id && item.slot.instanceId !== slot.instanceId
        && item.slot.original.trim().length >= 30 && baseline.project.instances[item.slot.instanceId]?.frame)
        .sort((a, b) => b.slot.original.trim().length - a.slot.original.trim().length)[0]
      assert.ok(selectedBody, 'No formal fixed-frame body slot found on the selected reference page; inspect available-slots.json.')
      const bodySlot = selectedBody.slot, originalBody = baseline.project.instances[bodySlot.instanceId]!
      const referenceIds: string[] = []
      const walk = (id: string) => { referenceIds.push(id); baseline.project.instances[id]?.childIds?.forEach(walk) }
      walk(surface.id)
      const page = await host.tools.issueTarget(runId, initial.documentId, { kind: 'course-surface', surfaceId: surface.id })
      const inspected = await call('surface.remix.inspect', { target: page })
      assert.equal(inspected.kind, 'read')
      const view = (inspected as any).data as { target: string; slots: Array<{ id: string; original: string; capacity: string }> }
      const publicSlot = view.slots.find(item => item.id === slot.id)
      const publicBodySlot = view.slots.find(item => item.id === bodySlot.id)
      assert.ok(publicSlot); assert.ok(publicBodySlot)
      assert.equal(Object.hasOwn(publicSlot, 'instanceId'), false, 'The public consumer must not need to copy internal object identities.')
      const replacement = '河畔周末市集'
      const bodyReplacement = variant === 'normal'
        ? '河畔市集重新开张。用一组虚构经营数据，观察客流、天气与成本怎样共同影响一天的结余。'
        : '河畔市集重新开张。' + '本段是确定性容量边界探针，文字必须保留，不能用隐藏或缩小字号伪装适配。'.repeat(8)
      const applied = await call('surface.remix', { target: view.target,
        replacements: { [publicSlot.id]: replacement, [publicBodySlot.id]: bodyReplacement } })
      assert.equal(committedFact('surface.remix', applied)?.status, 'applied')
      const afterRemix = await host.internalAPI.read(initial.documentId), remixed = course(afterRemix)
      const oldSurfaces = new Set(componentSurfaces(baseline.project).map(item => item.id))
      const added = componentSurfaces(remixed.project).filter(item => !oldSurfaces.has(item.id))
      assert.equal(added.length, 1)
      const createdSurface = added[0]!
      const newSlot = inspectCourseRemixSlots(remixed.project, createdSurface.id).slots.find(item => item.original === replacement)
      const newBodySlot = inspectCourseRemixSlots(remixed.project, createdSurface.id).slots.find(item => item.original === bodyReplacement)
      assert.ok(newSlot); assert.ok(newBodySlot)
      assert.notEqual(newSlot.instanceId, slot.instanceId)
      assert.notEqual(newBodySlot.instanceId, bodySlot.instanceId)
      assert.deepEqual(remixed.project.instances[newSlot.instanceId]!.frame, originalInstance.frame)
      assert.deepEqual(remixed.project.instances[newBodySlot.instanceId]!.frame, originalBody.frame)
      for (const id of referenceIds) assert.deepEqual(remixed.project.instances[id], baseline.project.instances[id])
      assertOriginalResources(baseline.resources, remixed.resources)
      assert.equal(afterRemix.undoDepth, initial.undoDepth + 1)
      const session = host.registry.get(initial.documentId)
      const history = async (type: 'undo' | 'redo') => {
        const current = session.read()
        const result = await session.execute({ documentId: current.documentId, epoch: current.epoch,
          baseRevision: current.revision, operationId: randomUUID(), actor: 'human', mutation: { type } })
        assert.equal(result.status, 'applied')
        return course(session.read())
      }
      let finalText = replacement, continuationWithoutRead = false
      if (variant === 'normal') {
        assert.deepEqual(withoutRevision((await history('undo')).project), withoutRevision(baseline.project))
        assert.deepEqual(withoutRevision((await history('redo')).project), withoutRevision(remixed.project))
        const target = await host.tools.issueTarget(runId, initial.documentId,
          { kind: 'course-instance', surfaceId: createdSurface.id, instanceId: newSlot.instanceId, dataPath: newSlot.dataPath })
        assert.equal(committedFact('text.replace', await call('text.replace', { target, content: '江畔周末市集', format: 'text' }))?.status, 'applied')
        // Deliberately continue the acknowledged target: no extra read, inspect, or re-issued handle.
        finalText = '河湾周末市集'
        assert.equal(committedFact('text.replace', await call('text.replace', { target, content: finalText, format: 'text' }))?.status, 'applied')
        continuationWithoutRead = true
        const edited = course(await host.internalAPI.read(initial.documentId))
        assert.ok(inspectCourseRemixSlots(edited.project, createdSurface.id).slots.some(item => item.original === finalText))
        assert.ok(inspectCourseRemixSlots((await history('undo')).project, createdSurface.id).slots.some(item => item.original === '江畔周末市集'))
        assert.deepEqual(withoutRevision((await history('redo')).project), withoutRevision(edited.project))
      }
      const currentPage = await host.tools.issueTarget(runId, initial.documentId, { kind: 'course-surface', surfaceId: createdSurface.id })
      const label = variant === 'normal' ? 'E0 正常内容' : 'E0 超出容量'
      await call('surface.configure', { target: currentPage, settings: { title: label } })
      const document = await host.tools.issueTarget(runId, initial.documentId, { kind: 'document' })
      const saved = await call('file.save', { target: document })
      assert.equal((saved as any).data?.status, 'saved')
      const offline = join(workspace, `template-${variant}.html`)
      const savedSnapshot = await host.internalAPI.read(initial.documentId), finalModel = course(savedSnapshot)
      assert.equal(savedSnapshot.dirty, false)
      assert.ok(inspectCourseRemixSlots(finalModel.project, createdSurface.id).slots
        .some(item => item.instanceId === newBodySlot.instanceId && item.original === bodyReplacement))
      for (const id of referenceIds) assert.deepEqual(finalModel.project.instances[id], baseline.project.instances[id])
      assertOriginalResources(baseline.resources, finalModel.resources)
      const coldHost = new DocumentHostService(join(directory, `${variant}-independent-cold-documents`))
      const cold = await coldHost.open(file)
      assert.deepEqual(course(cold), finalModel)
      assert.equal(cold.dirty, false)
      facts.cases.push({ variant, file, offline, label, createdSurfaceId: createdSurface.id,
        surfaceIndex: componentSurfaces(finalModel.project).findIndex(item => item.id === createdSurface.id),
        surfaceCount: componentSurfaces(finalModel.project).length, probeRole: 'body', instanceId: newBodySlot.instanceId,
        sourceInstanceId: bodySlot.instanceId, originalText: bodySlot.original, text: bodyReplacement,
        frame: finalModel.project.instances[newBodySlot.instanceId]!.frame, publicCapacity: publicBodySlot.capacity,
        titleProbe: { instanceId: newSlot.instanceId, sourceInstanceId: slot.instanceId, originalText: slot.original, text: finalText,
          frame: finalModel.project.instances[newSlot.instanceId]!.frame, publicCapacity: publicSlot.capacity },
        savedRevision: savedSnapshot.revision, glxSha256: digest(await fs.readFile(file)),
        offlineExport: 'pending-real-browser-producer', sourceReferenceUnchanged: true, originalResourcesPreserved: true,
        continuationWithoutRead, formalHistoryVerified: variant === 'normal', independentHostColdOpen: true,
        expectedVisualOutcome: variant === 'normal' ? 'text-fits-original-frame' : 'overflow-is-detected-not-certified-as-fit' })
      await host.tools.stop(runId)
      active.splice(active.findIndex(item => item.runId === runId), 1)
      await json(join(directory, 'node-result.json'), facts)
    }
    assert.equal(digest(await fs.readFile(source)), sourceSha256)
    Object.assign(facts, { status: 'passed', completedAt: new Date().toISOString(), sourceUnchanged: true,
      visualVerification: 'pending; run templateE020261030.spec.ts before calling E0 complete' })
    await json(join(directory, 'node-result.json'), facts)
    await json(join(output, 'latest-node.json'), facts)
    console.log(JSON.stringify({ status: facts.status, directory, manifest: join(directory, 'node-result.json'), cases: facts.cases.length }))
    return facts
  } catch (error) {
    Object.assign(facts, { status: 'failed', error: error instanceof Error ? error.stack : String(error), completedAt: new Date().toISOString(),
      sourceUnchanged: digest(await fs.readFile(source)) === sourceSha256 })
    await json(join(directory, 'node-failure.json'), facts)
    await json(join(output, 'latest-node-failure.json'), facts)
    throw error
  } finally {
    for (const item of active) await item.host.tools.stop(item.runId).catch(() => undefined)
  }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/templateE020261030.node.ts')) {
  runTemplateE0().catch(error => { console.error(error); process.exitCode = 1 })
}

