/** Repair the supplied archive through the formal module writer, retaining the original. */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform'
import { buildComponentSingleHtml, buildCompiledSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { repairOasisProgress } from '../fixtures/creation/repairOasisProgress'
import { repairOasisAudio } from '../fixtures/creation/repairOasisAudio'
import { repairOasisDebrief } from '../fixtures/creation/repairOasisDebrief'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const serializable = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? [...item] : item))
const course = (snapshot: DocumentSnapshot) => {
  assert(snapshot.model.kind === 'course-v10'); return snapshot.model
}
const modules = (model: ReturnType<typeof course>, rootId: string): Record<string, string> => {
  const data = model.project.instances[rootId]!.data
  assert(data && typeof data === 'object' && !Array.isArray(data))
  const value = data.modules
  assert(value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(item => typeof item === 'string'))
  return value as Record<string, string>
}

export async function prepareOasisRepair(input: { original: string; out: string }) {
  assert(path.isAbsolute(input.original) && path.isAbsolute(input.out))
  const originalBytes = await fs.readFile(input.original), originalHash = hash(originalBytes)
  assert.equal(originalHash, 'ff0185a105a40d64069860d0210515d511df17fb39ed0cd9ce311fc8250bdaad', 'The original r10 archive changed; do not apply a repair to an unknown baseline')
  await fs.mkdir(input.out, { recursive: true })
  const host = new DocumentHostService(path.join(input.out, 'recovery'))
  const original = await host.internalAPI.open(input.original), copy = structuredClone(course(original))
  copy.project.id = randomUUID()
  copy.project.title = '无光绿洲：深海失联 · 进度、语音与复盘修复副本'
  const rootId = copy.project.entry!.rootInstanceId
  const originalModules = modules(copy, rootId)
  const originalShell = originalModules['shell.js']!
  const repaired = repairOasisProgress(originalShell)
  const originalAudio = originalModules['audio.js']!, repairedAudio = repairOasisAudio(originalAudio)
  const originalIntro = originalModules['intro.js']!, repairedIntro = repairOasisDebrief(originalIntro)
  assert(!repaired.includes('localStorage.'))
  assert(repaired.includes('progressPort.write') && repaired.includes('progressPort.clear'))
  await fs.writeFile(path.join(input.out, 'shell-progress-repair.js'), repaired)
  await fs.writeFile(path.join(input.out, 'audio-alias-repair.js'), repairedAudio)
  await fs.writeFile(path.join(input.out, 'intro-debrief-repair.js'), repairedIntro)
  // Real JavaScript parser/compiler admission; the fixture does not execute a fake module.
  await build({ stdin: { contents: repaired, sourcefile: 'shell.js' }, write: false, format: 'esm', bundle: false, logLevel: 'silent' })
  await build({ stdin: { contents: repairedAudio, sourcefile: 'audio.js' }, write: false, format: 'esm', bundle: false, logLevel: 'silent' })
  await build({ stdin: { contents: repairedIntro, sourcefile: 'intro.js' }, write: false, format: 'esm', bundle: false, logLevel: 'silent' })
  const document = await host.internalAPI.create(copy, 'oasis-progress-repaired.glx')
  const runId = `oasis-repair-${randomUUID()}`
  await host.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: document.documentId, writable: [{ kind: 'document' }] }],
    fileAccess: { workspaceRoot: input.out, permission: 'workspace' } })
  try {
    const file = componentProjectFiles(copy.project, copy.resources).find(file => file.webModule?.path === 'shell.js'
      && file.target?.kind === 'instance' && file.target.instanceId === rootId)
    assert(file, 'The actual single-author-module projection is missing')
    const read = await host.tools.execute(runId, 'read-shell', { name: 'project.read', input: { path: file.path } })
    assert.equal(read.kind, 'read')
    const receipt = await host.tools.execute(runId, 'repair-shell', { name: 'project.apply', input: { path: file.path, content: repaired } })
    assert(receipt.kind === 'read' && (receipt.data as any).commit === 'committed', JSON.stringify(receipt))
    const audioFile = componentProjectFiles(copy.project, copy.resources).find(file => file.webModule?.path === 'audio.js'
      && file.target?.kind === 'instance' && file.target.instanceId === rootId)
    assert(audioFile, 'The audio module projection is missing')
    const audioRead = await host.tools.execute(runId, 'read-audio', { name: 'project.read', input: { path: audioFile.path } })
    assert.equal(audioRead.kind, 'read')
    const audioReceipt = await host.tools.execute(runId, 'repair-audio', { name: 'project.apply', input: { path: audioFile.path, content: repairedAudio } })
    assert(audioReceipt.kind === 'read' && (audioReceipt.data as any).commit === 'committed', JSON.stringify(audioReceipt))
    const debriefFile = componentProjectFiles(copy.project, copy.resources).find(file => file.webModule?.path === 'intro.js'
      && file.target?.kind === 'instance' && file.target.instanceId === rootId)
    assert(debriefFile, 'The debrief module projection is missing')
    const debriefRead = await host.tools.execute(runId, 'read-debrief', { name: 'project.read', input: { path: debriefFile.path } })
    assert.equal(debriefRead.kind, 'read')
    const debriefReceipt = await host.tools.execute(runId, 'repair-debrief', { name: 'project.apply', input: { path: debriefFile.path, content: repairedIntro } })
    assert(debriefReceipt.kind === 'read' && (debriefReceipt.data as any).commit === 'committed', JSON.stringify(debriefReceipt))
    let current = await host.internalAPI.read(document.documentId)
    const expected = structuredClone(copy)
    expected.project.revision = course(current).project.revision
    modules(expected, rootId)['shell.js'] = repaired
    modules(expected, rootId)['audio.js'] = repairedAudio
    modules(expected, rootId)['intro.js'] = repairedIntro
    assert.deepEqual(course(current), expected, 'A field outside the three repaired modules changed')
    assert.equal(current.undoDepth, 3)
    for (const step of [1, 2, 3]) {
      const undo = await host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
        actor: 'human', operationId: `undo-repair-${step}`, mutation: { type: 'undo' } })
      assert.equal(undo.status, 'applied'); current = await host.internalAPI.read(document.documentId)
    }
    assert.deepEqual(modules(course(current), rootId), originalModules)
    for (const step of [1, 2, 3]) {
      assert.equal((await host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
        actor: 'human', operationId: `redo-repair-${step}`, mutation: { type: 'redo' } })).status, 'applied')
      current = await host.internalAPI.read(document.documentId)
    }
    const filename = path.join(input.out, '无光绿洲_深海失联_修复版.glx')
    await host.internalAPI.save(document.documentId, filename)
    const coldFile = path.join(input.out, 'cold-snapshot.json')
    const code = `import {DocumentHostService} from ${JSON.stringify(pathToFileURL(path.resolve('src/main/workbench/DocumentHostService.ts')).href)};import {writeFile} from 'node:fs/promises';const s=await new DocumentHostService(${JSON.stringify(path.join(input.out, 'cold-recovery'))}).open(${JSON.stringify(filename)});await writeFile(${JSON.stringify(coldFile)},JSON.stringify(s,(_k,v)=>v instanceof Uint8Array?[...v]:v));`
    await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', code], { cwd: process.cwd(), timeout: 45_000, maxBuffer: 1024 * 1024 })
    const cold = JSON.parse(await fs.readFile(coldFile, 'utf8')) as DocumentSnapshot
    assert.deepEqual(cold.model, serializable(current.model), 'An independent cold-open process changed the saved author model')
    const final = course(current)
    const publication = await buildPublishedCourseV3({ project: final.project, assetBytes: final.resources.assets,
      componentFiles: final.resources.components }, { compilation: host.compilation, singleHtmlMode: 'offline-portable' })
    const originalModel = course(original)
    const baselinePublication = await buildPublishedCourseV3({ project: originalModel.project, assetBytes: originalModel.resources.assets,
      componentFiles: originalModel.resources.components }, { compilation: host.compilation, singleHtmlMode: 'offline-portable' })
    await fs.writeFile(path.join(input.out, 'publication-preflight.json'), JSON.stringify({ offlineComplete: publication.offlineComplete,
      diagnostics: publication.diagnostics, originalDiagnostics: baselinePublication.diagnostics }, null, 2))
    // The original authored shell builds HTML and fetches its local audio dynamically.
    // Retain those conservative diagnostics; the separate offline consumer must prove
    // the promised main path. Never turn a static unknown into a fake success flag.
    assert.deepEqual(publication.diagnostics, baselinePublication.diagnostics, 'The repair introduced a new publication diagnostic')
    assert(publication.diagnostics.every(issue => issue.code === 'network-dependency'
      && issue.message.includes('不能静态确定依赖') && issue.path.at(-1) === 'modules'))
    const [publishedBundle, compiledBundle] = await Promise.all([
      build({ entryPoints: ['src/player/componentPlatform/entry.ts'], bundle: true, platform: 'browser', format: 'iife',
        globalName: 'CoursewarePlayer', write: false, loader: { '.css': 'empty' }, logLevel: 'silent' }),
      build({ entryPoints: ['src/player/componentPlatform/compiledEntry.ts'], bundle: true, platform: 'browser', format: 'iife',
        globalName: 'CoursewareCompiledPlayer', write: false, loader: { '.css': 'empty' }, logLevel: 'silent' }),
    ])
    const publishedFile = path.join(input.out, '无光绿洲_修复版_Published.html')
    await fs.writeFile(publishedFile, buildComponentSingleHtml(publication.payload, publishedBundle.outputFiles[0]!.text))
    const dom = new JSDOM('<!doctype html><html><body></body></html>')
    let compiledFile: string
    try {
      const compiled = await compileCoursePlayback(publication.payload, { document: dom.window.document,
        renderBuiltin: async (_instance, key) => { throw new Error(`Unexpected static component in original program: ${key}`) } })
      assert.deepEqual(compiled.diagnostics, [])
      compiledFile = path.join(input.out, '无光绿洲_修复版_离线体验.html')
      await fs.writeFile(compiledFile, buildCompiledSingleHtml(compiled, compiledBundle.outputFiles[0]!.text))
    } finally { dom.window.close() }
    const audio: unknown[] = []
    for (const asset of Object.values(final.project.assets)) if (asset.kind === 'audio' || asset.mimeType?.startsWith('audio/')) {
      const bytes = final.resources.assets[asset.id]; assert(bytes)
      const audioPath = path.join(input.out, 'audio', path.basename(asset.filename ?? `${asset.id}.wav`))
      await fs.mkdir(path.dirname(audioPath), { recursive: true }); await fs.writeFile(audioPath, bytes)
      audio.push({ id: asset.id, file: audioPath, sha256: hash(bytes), bytes: bytes.byteLength })
    }
    assert.equal(hash(await fs.readFile(input.original)), originalHash)
    const facts = { status: 'saved-cold-opened-and-exported', original: input.original, originalHash, originalUnchanged: true,
      originalRevision: course(original).project.revision, repairedProjectId: final.project.id, revision: final.project.revision,
      modules: [file.path, audioFile.path, debriefFile.path], shellBeforeHash: hash(originalShell), shellAfterHash: hash(repaired),
      audioBeforeHash: hash(originalAudio), audioAfterHash: hash(repairedAudio), debriefBeforeHash: hash(originalIntro), debriefAfterHash: hash(repairedIntro),
      otherFiveModulesUnchanged: true, captionLifecycle: 'dismiss-next-caption-or-scene-cleanup',
      logicalHistoryEntries: 3, undoRedo: true, coldProcess: true, authorLearningRecords: false,
      glx: filename, glxHash: hash(await fs.readFile(filename)), published: publishedFile, compiled: compiledFile!, audio,
      staticOfflineComplete: publication.offlineComplete, publicationDiagnostics: publication.diagnostics,
      runtimeValidation: 'pending separate real-browser consumer' }
    await fs.writeFile(path.join(input.out, 'repair-preparation.json'), JSON.stringify(facts, null, 2))
    return facts
  } finally { await host.tools.stop(runId) }
}
