/**
 * Read-only r12 consumer. Run from the repository root:
 * node scripts/experiments/a2-r12-packaged-cold-20261101.mjs source.glx original-r10.glx fresh-output packaged.exe
 * Uses the source's sibling .html as the first r12 export. Never sends a model request or edits the author.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { _electron as electron, expect } from '@playwright/test'
import { unzipSync } from 'fflate'
import { atomicJson, bounded, closeOwnedApp, errorSummary } from './builtin-moon-cleanup-recovery-20261101.mjs'

assert.equal(process.argv.length, 6, 'Expected sourceGLX, original-r10, fresh-output and packagedEXE.')
assert.equal(process.platform, 'win32', 'This consumer requires the actual Windows directory package.')
const [source, original, out, executable] = process.argv.slice(2).map(value => path.resolve(value))
const PROJECT = '53751eec-194a-497e-b871-47e07f6ce687'
const PROGRAM = 'ba18b327-1d77-4ada-a372-9ff2c59c9c0f'
const TITLE = 'c6c4c035-2078-4bda-98b6-22b87dccbd39'
const HUMAN_TITLE = '借来的月光，变化的形。'
const RESET_LABEL = '回到上弦'
const EXPECTED_PATH = 'pages/02-转动视角/04-HTML 程序.content.html'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const samePath = (left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes)
assert.equal(path.extname(source).toLowerCase(), '.glx')
assert(!samePath(source, original), 'The r12 input must be distinct from the protected r10 original.')
const firstHtml = source.slice(0, -path.extname(source).length) + '.html'
await fs.mkdir(out, { recursive: true })
assert.equal((await fs.readdir(out)).length, 0, 'Use a fresh, empty evidence directory.')
const workspace = path.join(out, 'workspace'), profile = path.join(out, 'profile')
await fs.mkdir(workspace); await fs.mkdir(profile)
const document = path.join(workspace, path.basename(source))
const destination = path.join(workspace, path.basename(firstHtml))
const report = { kind: 'A2-r12-independent-packaged-cold', startedAt: new Date().toISOString(),
  phase: 'independent-archive-baseline', status: 'running', source, original, firstHtml,
  document, workspace, profile, executable, modelSends: 0, errors: [], network: [] }
const persist = () => atomicJson(out, 'result.json', report)
const protectedInputs = new Map()
let app, page

function archive(bytes, revision) {
  const entries = unzipSync(bytes)
  assert(entries['project.json'] && entries['resource-index.json'], 'Expected the official GLX project and resource index.')
  const project = JSON.parse(decode(entries['project.json']))
  const index = JSON.parse(decode(entries['resource-index.json']))
  assert.equal(project.schemaVersion, 11); assert.equal(project.id, PROJECT); assert.equal(project.revision, revision)
  assert.equal(index.format, 'guoling-resource-index'); assert.equal(index.version, 1)
  assert(index.paths && typeof index.paths === 'object' && !Array.isArray(index.paths))
  const indexedHashes = {}
  for (const [logicalPath, digest] of Object.entries(index.paths)) {
    assert(/^assets\/[^/]+$/.test(logicalPath), 'This frozen A2 fixture contains asset resources only.')
    assert.equal(typeof digest, 'string'); assert(/^[a-f0-9]{64}$/.test(digest))
    const body = entries[`resources/sha256/${digest}`]
    assert(body, `The indexed resource is missing: ${logicalPath}`)
    assert.equal(hash(body), digest, `The archive resource has changed: ${logicalPath}`)
    indexedHashes[logicalPath] = digest
  }
  const assetHashes = Object.fromEntries(Object.entries(project.assets).map(([id, metadata]) => {
    assert.equal(typeof metadata.path, 'string')
    assert(Object.hasOwn(indexedHashes, metadata.path), `The author asset is absent from the resource index: ${id}`)
    return [id, indexedHashes[metadata.path]]
  }))
  assert.deepEqual(Object.values(project.assets).map(metadata => metadata.path).sort(), Object.keys(indexedHashes).sort())
  assert.equal(Object.keys(assetHashes).length, 3, 'The A2 source must retain its three original resources.')
  assert.equal(project.instances[TITLE].data.content.inlines[0].text, HUMAN_TITLE)
  assert.equal(typeof project.instances[PROGRAM].data.html, 'string')
  assert(project.instances[PROGRAM].data.html.includes(RESET_LABEL))
  return { entries, project, index, assets: assetHashes, components: {} }
}

async function author(id) {
  return bounded('Read the opened author and resource bytes', () => page.evaluate(async documentId => {
    const snapshot = await window.desktopAPI.documents.read(documentId)
    if (snapshot.model.kind !== 'course-v10') throw new Error('Expected the current official course model.')
    const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))]
      .map(value => value.toString(16).padStart(2, '0')).join('')
    return { documentId: snapshot.documentId, epoch: snapshot.epoch, binding: snapshot.binding,
      revision: snapshot.revision, dirty: snapshot.dirty, project: snapshot.model.project,
      assets: Object.fromEntries(await Promise.all(Object.entries(snapshot.model.resources.assets)
        .map(async ([key, bytes]) => [key, await sha(bytes)]))),
      components: Object.fromEntries(await Promise.all(Object.entries(snapshot.model.resources.components)
        .map(async ([key, files]) => [key, Object.fromEntries(await Promise.all(Object.entries(files)
          .map(async ([name, bytes]) => [name, await sha(bytes)])))]))) }
  }, id), 15000)
}

try {
  await persist()
  const [sourceBytes, originalBytes, firstHtmlBytes] = await Promise.all([fs.readFile(source), fs.readFile(original), fs.readFile(firstHtml)])
  protectedInputs.set(source, hash(sourceBytes)); protectedInputs.set(original, hash(originalBytes)); protectedInputs.set(firstHtml, hash(firstHtmlBytes))
  const expected = archive(sourceBytes, 12), baseline = archive(originalBytes, 10)
  const expectedRest = structuredClone(expected.project), baselineRest = structuredClone(baseline.project)
  expectedRest.revision = baselineRest.revision
  delete expectedRest.instances[PROGRAM].data.html; delete baselineRest.instances[PROGRAM].data.html
  assert.deepEqual(expectedRest, baselineRest, 'Every author field outside the target HTML and revision must remain exact.')
  assert.notEqual(expected.project.instances[PROGRAM].data.html, baseline.project.instances[PROGRAM].data.html)
  assert.deepEqual(Object.keys(expected.entries).sort(), Object.keys(baseline.entries).sort())
  for (const entry of Object.keys(expected.entries).filter(name => name !== 'project.json'))
    assert.deepEqual(expected.entries[entry], baseline.entries[entry], `The non-project archive entry must be unchanged: ${entry}`)
  await fs.writeFile(document, sourceBytes, { flag: 'wx' })
  assert.equal(hash(await fs.readFile(document)), protectedInputs.get(source))
  protectedInputs.set(document, protectedInputs.get(source))
  report.input = { sourceSha256: protectedInputs.get(source), r10Sha256: protectedInputs.get(original),
    firstHtmlSha256: protectedInputs.get(firstHtml), projectId: PROJECT, revision: 12, targetInstance: PROGRAM,
    changedFields: [`instances.${PROGRAM}.data.html`, 'revision'], assetHashes: expected.assets }
  await atomicJson(out, 'archive-author.json', { project: expected.project, assets: expected.assets, components: expected.components })

  report.phase = 'launch-isolated-package'; await persist()
  const env = { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', COURSEWARE_E2E_BACKGROUND: '0',
    COURSEWARE_COMPONENTS_DIR: path.join(out, 'missing-development-catalog') }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ executablePath: executable, cwd: out,
    args: ['--user-data-dir=' + profile], env, timeout: 45000 })
  report.pid = app.process().pid
  report.application = await app.evaluate(({ app }) => ({ isPackaged: app.isPackaged, appPath: app.getAppPath(),
    execPath: process.execPath, userData: app.getPath('userData'), cwd: process.cwd(), version: app.getVersion() }))
  assert.equal(report.application.isPackaged, true)
  assert(samePath(report.application.execPath, executable))
  assert(samePath(report.application.appPath, path.join(path.dirname(executable), 'resources', 'app.asar')))
  assert(samePath(report.application.userData, profile)); assert(samePath(report.application.cwd, out))
  page = await app.firstWindow({ timeout: 45000 }); page.setDefaultTimeout(15000)
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('request', request => { if (/^https?:/.test(request.url())) report.network.push(request.url()) })
  const ownedWindow = await app.browserWindow(page)
  await ownedWindow.evaluate(window => { window.setContentSize(1500, 1000); window.show(); window.focus() })
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, workspace)
  await page.getByLabel('切换工作空间', { exact: true }).click()
  await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
  await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: path.basename(document), exact: true }).dblclick()
  const editor = page.locator('.course-editor-frame:visible')
  await expect(editor).toBeVisible()
  await expect.poll(async () => {
    const id = await editor.getAttribute('data-document-id')
    if (!id) return false
    return page.evaluate(async ({ id, filename }) => {
      const snapshot = await window.desktopAPI.documents.read(id)
      return snapshot.binding.kind === 'file' && snapshot.binding.path === filename
    }, { id, filename: document })
  }).toBe(true)
  const id = await editor.getAttribute('data-document-id'); assert(id)
  report.phase = 'author-and-resource-identity'; await persist()
  const before = await author(id)
  assert.equal(before.revision, 12); assert.equal(before.dirty, false)
  assert.equal(before.binding.kind, 'file'); assert(samePath(before.binding.path, document))
  assert.deepEqual(before.project, expected.project, 'The cold App author must equal the independent r12 ZIP project.')
  assert.deepEqual(before.assets, expected.assets, 'Every asset identity and byte hash must match the GLX resource index.')
  assert.deepEqual(before.components, expected.components)
  await expect(page.locator(`[data-component-instance="${TITLE}"]:visible`)).toContainText(HUMAN_TITLE)
  await atomicJson(out, 'cold-author.json', before)
  report.author = { revision: before.revision, dirty: before.dirty, matchesZipProject: true,
    assetsMatchZipBytes: true, humanTitleVisible: true, humanTitle: HUMAN_TITLE }

  report.phase = 'formal-source-read'; await persist()
  const receipts = await bounded('Read the exact r12 lab', () => app.evaluate(async ({ app }, input) => {
    const requireProduct = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json')
    const host = requireProduct('./dist-electron/main/workbench/documentHost.js').documentHost()
    const { componentProjectFiles } = requireProduct('./dist-electron/core/projectFiles/componentPlatform/projection.js')
    const matches = componentProjectFiles(input.expectedProject, { assets: {}, components: {} })
      .filter(file => file.kind === 'html' && file.target?.kind === 'instance' && file.target.instanceId === input.program)
    if (matches.length !== 1 || typeof matches[0].content !== 'string') throw new Error('The target must have one official HTML projection.')
    const projected = matches[0]
    await host.tools.beginRun({ runId: input.runId, actor: 'human',
      documents: [{ documentId: input.id, writable: [{ kind: 'document' }] }],
      fileAccess: { permission: 'workspace', workspaceRoot: input.workspace } })
    try {
      // limit bounds entry count; the owner's delivery budget can still paginate.
      const lists = []
      let offset = 0, listed = false, paginationError = null
      while (true) {
        const callId = `list-source-${offset}`
        const result = await host.tools.execute(input.runId, callId,
          { name: 'project.list', input: { limit: 1000, offset } })
        lists.push({ callId, offset, result })
        if (result.kind !== 'read' || !Array.isArray(result.data.files)) {
          paginationError = 'The directory page did not return a formal file list.'; break
        }
        if (result.data.revision !== 12 || result.data.currentRevision !== 12) {
          paginationError = 'The directory revision changed while locating the r12 target.'; break
        }
        if (result.data.offset !== offset) {
          paginationError = 'The returned directory page did not match its requested offset.'; break
        }
        if (result.data.files.some(file => file.path === projected.path)) { listed = true; break }
        const next = result.data.nextOffset
        if (next === undefined || next === null) break
        if (!Number.isSafeInteger(next) || next <= offset) {
          paginationError = 'The directory nextOffset did not advance.'; break
        }
        offset = next
      }
      const source = listed && !paginationError
        ? await host.tools.execute(input.runId, 'read-source', { name: 'project.read', input: { path: projected.path, full: true } })
        : null
      return { projected: { path: projected.path, target: projected.target, content: projected.content },
        lists, listed, paginationError, source }
    } finally { await host.tools.stop(input.runId) }
  }, { runId: 'a2-r12-cold-read-' + randomUUID(), id, program: PROGRAM, expectedProject: expected.project, workspace }), 15000)
  await atomicJson(out, 'formal-source-receipts.json', receipts)
  assert.equal(receipts.projected.path, EXPECTED_PATH)
  assert.equal(receipts.projected.target.kind, 'instance'); assert.equal(receipts.projected.target.instanceId, PROGRAM)
  assert(receipts.lists.length > 0)
  for (const { offset, result } of receipts.lists) {
    assert.equal(result.kind, 'read'); assert.equal(result.data.revision, 12)
    assert.equal(result.data.currentRevision, 12); assert.equal(result.data.offset, offset)
  }
  assert.equal(receipts.paginationError, null)
  assert.equal(receipts.listed, true, 'The exact target path must occur in the enumerated formal directory pages.')
  assert(receipts.source, 'Do not read an unlisted target or export after incomplete directory enumeration.')
  assert.equal(receipts.source.kind, 'read'); assert.equal(receipts.source.data.path, receipts.projected.path)
  assert.equal(receipts.source.data.documentId, id); assert.equal(receipts.source.data.epoch, before.epoch)
  assert.equal(receipts.source.data.revision, 12); assert.equal(receipts.source.data.currentRevision, 12)
  assert.equal(receipts.source.data.complete, true); assert.equal(receipts.source.data.hasMore, false)
  assert.equal(receipts.source.data.content, receipts.projected.content, 'The formal read must match the independently projected r12 source in full.')
  assert(receipts.source.data.content.includes(RESET_LABEL))
  report.formalSource = { path: receipts.projected.path, targetInstance: PROGRAM, revision: 12,
    directoryPages: receipts.lists.length, directoryOffsets: receipts.lists.map(item => item.offset),
    exactProjectedContent: true, resetLabelPreserved: RESET_LABEL }
  report.phase = 'formal-r12-export-once'; await persist()
  const exported = await bounded('Export the cold r12 once', () => app.evaluate(async ({ app }, input) => {
    const requireProduct = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json')
    const host = requireProduct('./dist-electron/main/workbench/documentHost.js').documentHost()
    await host.tools.beginRun({ runId: input.runId, actor: 'human',
      documents: [{ documentId: input.id, writable: [{ kind: 'document' }] }],
      fileAccess: { permission: 'workspace', workspaceRoot: input.workspace } })
    try {
      await host.tools.loadToolFamilies(input.runId, ['build'])
      const opened = await host.tools.completeOpenedDocument(input.runId, { documentId: input.id, writable: true }, { selection: 'preserve' })
      return await host.tools.execute(input.runId, 'export-once', { name: 'document.export',
        input: { target: opened.target, format: 'html-offline', destination: input.destination } })
    } finally { await host.tools.stop(input.runId) }
  }, { runId: 'a2-r12-cold-export-' + randomUUID(), id, workspace, destination }), 30000)
  await atomicJson(out, 'export-receipt.json', exported)
  assert.equal(exported.kind, 'read'); assert.equal(exported.data.status, 'written')
  assert.equal(exported.data.format, 'html-offline'); assert(samePath(exported.data.path, destination))
  assert.equal(exported.data.exportedRevision, 12); assert.equal(exported.data.currentRevision, 12)
  assert.deepEqual(exported.data.warnings, [])
  const exportedBytes = await fs.readFile(destination)
  assert.deepEqual(exportedBytes, firstHtmlBytes, 'The cold packaged export must exactly equal the first r12 HTML.')
  assert.deepEqual(await author(id), before, 'Formal reads and export must not change the author or resource bytes.')
  assert.equal(hash(await fs.readFile(document)), protectedInputs.get(source))
  const settings = await page.evaluate(async () => {
    const settings = await window.desktopAPI.executionSettings.read()
    return { connections: settings.connections.length,
      configuredRoles: Object.values(settings.profile.roles).filter(value => value != null).length }
  })
  assert.deepEqual(settings, { connections: 0, configuredRoles: 0 })
  assert.deepEqual(report.errors, []); assert.deepEqual(report.network, [])
  report.export = { path: destination, revision: 12, sha256: hash(exportedBytes), bytes: exportedBytes.length,
    firstExport: firstHtml, matchesFirstExportBytes: true }
  report.settings = settings; report.status = 'a2-r12-packaged-cold-passed'; report.phase = 'complete'
} catch (error) {
  report.status = 'failed'; report.error = errorSummary(error)
} finally {
  try { report.close = await closeOwnedApp(app, async stage => { report.cleanupStage = stage; await persist() }) }
  catch (error) { report.close = { closed: false, error: errorSummary(error) } }
  if (!report.close.closed) report.status = 'failed'
  report.preserved = []
  for (const [filename, expectedHash] of protectedInputs) {
    try {
      const actual = hash(await fs.readFile(filename)), unchanged = actual === expectedHash
      report.preserved.push({ path: filename, expectedSha256: expectedHash, sha256: actual, unchanged })
      if (!unchanged) { report.status = 'failed'; report.integrityFailure = 'A protected source file changed.' }
    } catch (error) { report.status = 'failed'; report.preserved.push({ path: filename, error: errorSummary(error) }) }
  }
  report.finishedAt = new Date().toISOString(); await persist()
  console.log(JSON.stringify({ status: report.status, phase: report.phase, error: report.error,
    export: report.export, close: report.close, out }))
  process.exitCode = report.status === 'a2-r12-packaged-cold-passed' ? 0 : 1
}
