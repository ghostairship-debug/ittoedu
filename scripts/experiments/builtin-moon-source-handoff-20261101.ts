/** Deterministic formal-owner handoff on a second copy, after the real human UI edit. */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const creation = path.resolve('output/comprehensive-execution-20261101/creation')
const base = path.join(creation, 'builtin-moon-source-handoff')
const pointer = process.argv[2] || path.join(creation, 'builtin-moon-handoff/latest.json')
const programId = '4dc048ab-5f4f-49a8-99fb-662ffc05d035'
const oldText = '>复位</button>', newText = '>重置实验</button>'
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function author(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected a current course')
  return { project: snapshot.model.project,
    assets: Object.fromEntries(Object.entries(snapshot.model.resources.assets).map(([key, bytes]) => [key, hash(bytes)])),
    components: Object.fromEntries(Object.entries(snapshot.model.resources.components)
      .map(([key, files]) => [key, Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, hash(bytes)]))])),
    revision: snapshot.revision, dirty: snapshot.dirty }
}

async function main() {
  const latest = JSON.parse(await fs.readFile(pointer, 'utf8'))
  const human = JSON.parse(await fs.readFile(latest.result, 'utf8'))
  assert.equal(human.status, 'human-native-edit-cold-open-verified-source-handoff-pending')
  const humanBytes = await fs.readFile(human.document), humanHash = hash(humanBytes)
  assert.equal(humanHash, human.sha256, 'The actual UI-saved handoff copy must still match')
  assert.equal(hash(await fs.readFile(human.source)), human.sourceHash, 'The C original must still match')
  await fs.mkdir(base, { recursive: true })
  const out = await fs.mkdtemp(path.join(base, 'run-')), workspace = path.join(out, 'workspace')
  await fs.mkdir(workspace)
  const document = path.join(workspace, '月光的几何-源码接力.glx')
  await fs.writeFile(document, humanBytes, { flag: 'wx' })
  const host = new DocumentHostService(path.join(out, 'owner-journal'))
  const runId = 'builtin-moon-source-' + randomUUID()
  let documentId: string | undefined, began = false, phase = 'open-copy'
  const operations: Array<{ id: string; name: string; result: unknown }> = []
  const checkpoint = async (details: object = {}) => {
    const state = { checkedAt: new Date().toISOString(), phase, runId, documentId, document, workspace, out,
      source: human.source, sourceHash: human.sourceHash, humanDocument: human.document, humanHash, ...details }
    const temporary = path.join(out, 'state.tmp.json'), destination = path.join(out, 'state.json')
    await fs.writeFile(temporary, JSON.stringify(state, null, 2)); await fs.rename(temporary, destination)
  }
  try {
    await checkpoint()
    const opened = await host.open(document)
    documentId = opened.documentId
    assert.equal(opened.model.kind, 'course-v10')
    if (opened.model.kind !== 'course-v10') throw new Error('Expected the current course model')
    const before = author(opened)
    const humanAuthor = JSON.parse(await fs.readFile(path.join(human.out, 'human-author.json'), 'utf8'))
    assert.deepEqual(before.project, humanAuthor.project)
    assert.deepEqual(before.assets, humanAuthor.assets); assert.deepEqual(before.components, humanAuthor.components)
    assert.ok(JSON.stringify(before.project.instances[human.titleId].data).includes(human.titleAfter))
    const data = before.project.instances[programId].data
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The HTML program author data must be an object')
    assert.equal(typeof data.html, 'string')
    const priorHtml = data.html as string
    assert.equal(priorHtml.split(oldText).length - 1, 1, 'The exact local author edit must be unique')
    // The formal projection supplies the current natural path; no virtual path is guessed from an ID.
    const candidates = componentProjectFiles(opened.model.project, opened.model.resources)
      .filter(file => file.kind === 'html' && file.target?.kind === 'instance' && file.target.instanceId === programId)
    assert.equal(candidates.length, 1, 'Exactly one current HTML author file belongs to the lab')
    const programPath = candidates[0]!.path
    await host.tools.beginRun({ runId, actor: 'agent',
      documents: [{ documentId, writable: [{ kind: 'document' }] }],
      fileAccess: { workspaceRoot: workspace, permission: 'workspace' } })
    began = true
    const call = async (name: string, input: Record<string, unknown>) => {
      const id = `${String(operations.length + 1).padStart(2, '0')}-${name}`
      const result = await host.tools.execute(runId, id, { name, input })
      operations.push({ id, name, result })
      await fs.writeFile(path.join(out, id + '.json'), JSON.stringify(result, null, 2))
      assert.equal(result.kind, 'read', JSON.stringify(result))
      if (result.kind !== 'read') throw new Error('Expected a formal read receipt')
      return result.data as Record<string, unknown>
    }
    phase = 'formal-path-read'; await checkpoint({ programPath })
    const directory = await call('project.list', { limit: 1000 })
    assert.ok(Array.isArray(directory.files), 'The formal directory must return files')
    assert.ok(directory.files.some(file => typeof file === 'object' && file && 'path' in file && file.path === programPath),
      'The selected author path must occur in the current formal directory')
    const read = await call('project.read', { path: programPath, full: true })
    assert.equal(read.complete, true, 'The exact edit uses a complete current source read')
    assert.equal(typeof read.content, 'string', 'The source owner must expose current author text')
    assert.equal((read.content as string).split(oldText).length - 1, 1,
      'The exact local edit must uniquely occur in the current formal source, including any owner CSS projection')
    assert.equal(read.revision, before.revision)
    phase = 'formal-local-edit'; await checkpoint({ programPath })
    const receipt = await call('project.apply', { path: programPath, edits: [{ old: oldText, new: newText }] })
    assert.equal(receipt.commit, 'committed', JSON.stringify(receipt))
    const changed = author(await host.internalAPI.read(documentId))
    const changedData = changed.project.instances[programId].data
    if (!changedData || typeof changedData !== 'object' || Array.isArray(changedData)) throw new Error('The edited HTML author data must remain an object')
    assert.equal(changedData.html, priorHtml.replace(oldText, newText))
    const normalized = structuredClone(changed.project)
    normalized.revision = before.project.revision
    const normalizedData = normalized.instances[programId].data
    if (!normalizedData || typeof normalizedData !== 'object' || Array.isArray(normalizedData)) throw new Error('The normalized HTML author data must remain an object')
    normalizedData.html = priorHtml
    assert.deepEqual(normalized, before.project, 'Every non-target author field, identity, frame and definition remains exact')
    assert.deepEqual(changed.assets, before.assets); assert.deepEqual(changed.components, before.components)
    assert.equal(changed.revision, before.revision + 1, 'The narrow source edit commits once')
    assert.equal(changed.dirty, true)
    phase = 'formal-save'; await checkpoint({ programPath, receipt })
    const saved = author(await host.saveToPath(documentId))
    assert.equal(saved.dirty, false)
    assert.deepEqual(saved.project, changed.project)
    assert.deepEqual(saved.assets, before.assets); assert.deepEqual(saved.components, before.components)
    const authorJSON = path.join(out, 'source-author.json')
    await fs.writeFile(authorJSON, JSON.stringify(saved, null, 2))
    assert.equal(hash(await fs.readFile(human.source)), human.sourceHash)
    assert.equal(hash(await fs.readFile(human.document)), humanHash)
    const result = { status: 'formal-source-edit-saved-awaiting-app-cold', checkedAt: new Date().toISOString(),
      source: human.source, sourceHash: human.sourceHash, humanDocument: human.document, humanHash,
      document, workspace, out, authorJSON, savedHash: hash(await fs.readFile(document)),
      titleId: human.titleId, titleAfter: human.titleAfter, programId, programPath, oldText, newText,
      revision: saved.revision, projectRevision: saved.project.revision, originalAndHumanCopyUnchanged: true,
      nonTargetAuthorFieldsPreserved: true, resourcesPreserved: true, modelRequests: 0,
      operationFiles: operations.map(operation => path.join(out, operation.id + '.json')) }
    await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2))
    phase = 'formal-source-saved'; await checkpoint({ result: path.join(out, 'result.json'), next: 'Run builtinMoonSourceCold20261101.spec.ts' })
    await fs.writeFile(path.join(base, 'latest.tmp.json'), JSON.stringify({ out, result: path.join(out, 'result.json') }, null, 2))
    await fs.rename(path.join(base, 'latest.tmp.json'), path.join(base, 'latest.json'))
    console.log(JSON.stringify({ status: result.status, out, programPath, revision: saved.revision,
      humanTitlePreserved: true, nonTargetAuthorFieldsPreserved: true }))
  } catch (error) {
    await fs.writeFile(path.join(out, 'failure.json'), JSON.stringify({ phase, error: String(error),
      stack: error instanceof Error ? error.stack : '', operations: operations.map(value => value.id) }, null, 2))
    await checkpoint({ status: 'failed', error: String(error), next: 'Read the recorded failure and real owner state before retrying' })
    throw error
  } finally {
    if (began) await host.tools.stop(runId)
    if (documentId && host.registry.has(documentId)) {
      const current = await host.internalAPI.read(documentId)
      // Failed mutations retain their journal and copy for inspection; no implicit discard or replay.
      if (!current.dirty) await host.operate({ type: 'close', documentId })
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
